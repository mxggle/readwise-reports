import { mkdir } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import type { DedupItem } from "./types.js";

// We use Node's built-in `node:sqlite` (DatabaseSync) rather than shelling out to
// the `sqlite3` CLI or pulling in a native module. This keeps the dedup store a
// zero-dependency, in-process affair: no per-item subprocess spawn, no reliance
// on a `sqlite3` binary being installed on the host, and parameterized queries
// instead of hand-escaped SQL string interpolation.
//
// `node:sqlite` is experimental in Node 22 and emits a one-time ExperimentalWarning
// on first construction; that is expected and harmless.

export type ProcessedStore = {
  dbPath: string;
  db: DatabaseSync;
};

export type FilterResult<T extends DedupItem = DedupItem> = {
  fresh: T[];
  skipped: T[];
};

/** A row as stored, projected for dedup decisions. */
type StoredRow = {
  item_id: string | null;
  url: string | null;
  content_hash: string;
  report_date: string | null;
  processed_at: string;
};

function emptyToNull(value: string | undefined | null): string | null {
  if (value === undefined || value === null || value === "") return null;
  return value;
}

function normalize(value: string | undefined | null): string {
  return (value || "").trim().replace(/\s+/g, " ");
}

function normalizeUrl(value: string | undefined | null): string {
  const raw = normalize(value);
  if (!raw) return "";
  try {
    const url = new URL(raw);
    url.hash = "";
    return url.toString().replace(/\/$/, "").toLowerCase();
  } catch {
    return raw.replace(/\/$/, "").toLowerCase();
  }
}

export function contentHash(item: DedupItem): string {
  const payload = [
    normalize(item.title).toLowerCase(),
    normalize(item.author).toLowerCase(),
    normalizeUrl(item.url || item.sourceUrl),
    normalize(item.text || item.summary).toLowerCase(),
  ].join("\n---\n");
  return createHash("sha256").update(payload).digest("hex");
}

/** The three dedup keys derived from an item. `id`/`url` may be null (no UNIQUE collision). */
function dedupKeys(item: DedupItem): { id: string | null; url: string | null; hash: string } {
  return {
    id: emptyToNull(normalize(item.id)),
    url: emptyToNull(normalizeUrl(item.url || item.sourceUrl)),
    hash: contentHash(item),
  };
}

export async function openProcessedStore(dbPath: string): Promise<ProcessedStore> {
  await mkdir(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec(`
PRAGMA journal_mode = DELETE;
CREATE TABLE IF NOT EXISTS processed_items (
  rowid INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id TEXT UNIQUE,
  url TEXT UNIQUE,
  content_hash TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  author TEXT,
  source TEXT NOT NULL,
  first_seen_at TEXT NOT NULL,
  processed_at TEXT NOT NULL,
  report_date TEXT,
  source_created_at TEXT,
  source_updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_processed_items_source ON processed_items(source);
CREATE INDEX IF NOT EXISTS idx_processed_items_report_date ON processed_items(report_date);
`);
  return { dbPath, db };
}

export async function hasProcessedItem(store: ProcessedStore, item: DedupItem): Promise<boolean> {
  return (await lookupProcessedReportDate(store, item)) !== null;
}

/**
 * Returns the report_date the item was first processed for, or null if unseen.
 * Used to keep same-day re-runs idempotent: an item already processed for the
 * current report date still belongs in today's report, whereas one processed
 * for an earlier date is genuine cross-day dedup and should be skipped.
 */
export async function lookupProcessedReportDate(store: ProcessedStore, item: DedupItem): Promise<string | null> {
  const { id, url, hash } = dedupKeys(item);
  const clauses: string[] = [];
  const params: string[] = [];
  if (id) {
    clauses.push("item_id = ?");
    params.push(id);
  }
  if (url) {
    clauses.push("url = ?");
    params.push(url);
  }
  clauses.push("content_hash = ?");
  params.push(hash);

  const row = store.db
    .prepare(`SELECT report_date FROM processed_items WHERE ${clauses.join(" OR ")} ORDER BY processed_at LIMIT 1;`)
    .get(...params) as { report_date: string | null } | undefined;

  if (!row) return null;
  return row.report_date ?? "";
}

export async function filterUnprocessed<T extends DedupItem>(
  store: ProcessedStore,
  items: T[],
  currentReportDate?: string,
): Promise<FilterResult<T>> {
  const fresh: T[] = [];
  const skipped: T[] = [];
  if (items.length === 0) return { fresh, skipped };

  const keys = items.map(dedupKeys);
  const ids = unique(keys.map((k) => k.id));
  const urls = unique(keys.map((k) => k.url));
  const hashes = unique(keys.map((k) => k.hash));

  // One batched query for the whole input set instead of a query per item.
  const clauses: string[] = [];
  const params: string[] = [];
  if (ids.length) {
    clauses.push(`item_id IN (${placeholders(ids.length)})`);
    params.push(...ids);
  }
  if (urls.length) {
    clauses.push(`url IN (${placeholders(urls.length)})`);
    params.push(...urls);
  }
  if (hashes.length) {
    clauses.push(`content_hash IN (${placeholders(hashes.length)})`);
    params.push(...hashes);
  }

  const rows = clauses.length
    ? (store.db
        .prepare(
          `SELECT item_id, url, content_hash, report_date, processed_at FROM processed_items WHERE ${clauses.join(" OR ")};`,
        )
        .all(...params) as StoredRow[])
    : [];

  // For each dedup key, keep the earliest-processed matching row — mirrors the
  // single-item `ORDER BY processed_at LIMIT 1`, so a re-marked item resolves to
  // its original report_date.
  const byId = new Map<string, StoredRow>();
  const byUrl = new Map<string, StoredRow>();
  const byHash = new Map<string, StoredRow>();
  const keepEarliest = (map: Map<string, StoredRow>, key: string | null, row: StoredRow) => {
    if (key == null) return;
    const prev = map.get(key);
    if (!prev || row.processed_at < prev.processed_at) map.set(key, row);
  };
  for (const row of rows) {
    keepEarliest(byId, row.item_id, row);
    keepEarliest(byUrl, row.url, row);
    keepEarliest(byHash, row.content_hash, row);
  }

  for (let i = 0; i < items.length; i++) {
    const k = keys[i];
    const candidates: StoredRow[] = [];
    if (k.id) {
      const r = byId.get(k.id);
      if (r) candidates.push(r);
    }
    if (k.url) {
      const r = byUrl.get(k.url);
      if (r) candidates.push(r);
    }
    const hr = byHash.get(k.hash);
    if (hr) candidates.push(hr);

    let seenReportDate: string | null = null;
    if (candidates.length > 0) {
      candidates.sort((a, b) => (a.processed_at < b.processed_at ? -1 : a.processed_at > b.processed_at ? 1 : 0));
      seenReportDate = candidates[0].report_date ?? "";
    }

    // Unseen, or already processed for *today's* report → keep it (idempotent re-run).
    // Processed for an earlier report date → cross-day dedup, skip.
    if (seenReportDate === null || (currentReportDate && seenReportDate === currentReportDate)) {
      fresh.push(items[i]);
    } else {
      skipped.push(items[i]);
    }
  }
  return { fresh, skipped };
}

export async function markProcessedItems<T extends DedupItem>(
  store: ProcessedStore,
  items: T[],
  reportDate: string,
  processedAt: string,
): Promise<void> {
  if (items.length === 0) return;
  const stmt = store.db.prepare(`INSERT OR IGNORE INTO processed_items (
    item_id, url, content_hash, title, author, source,
    first_seen_at, processed_at, report_date, source_created_at, source_updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`);

  store.db.exec("BEGIN IMMEDIATE;");
  try {
    for (const item of items) {
      const { id, url, hash } = dedupKeys(item);
      stmt.run(
        id,
        url,
        hash,
        normalize(item.title) || "Untitled",
        emptyToNull(normalize(item.author)),
        item.source,
        processedAt,
        processedAt,
        emptyToNull(reportDate),
        emptyToNull(item.createdAt),
        emptyToNull(item.updatedAt),
      );
    }
    store.db.exec("COMMIT;");
  } catch (err) {
    store.db.exec("ROLLBACK;");
    throw err;
  }
}

function unique(values: Array<string | null>): string[] {
  return [...new Set(values.filter((v): v is string => v !== null))];
}

function placeholders(count: number): string {
  return new Array(count).fill("?").join(",");
}
