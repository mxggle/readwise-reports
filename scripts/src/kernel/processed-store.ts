import { mkdir } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { execa } from "execa";
import type { DedupItem } from "./types.js";

export type ProcessedStore = {
  dbPath: string;
};

export type FilterResult<T extends DedupItem = DedupItem> = {
  fresh: T[];
  skipped: T[];
};

function sqlString(value: string | undefined | null): string {
  if (value === undefined || value === null || value === "") return "NULL";
  return `'${value.replace(/'/g, "''")}'`;
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

async function sqlite(dbPath: string, sql: string, json = false): Promise<string> {
  const args = json ? [dbPath, "-json", sql] : [dbPath, sql];
  const { stdout } = await execa("sqlite3", args);
  return stdout;
}

export async function openProcessedStore(dbPath: string): Promise<ProcessedStore> {
  await mkdir(path.dirname(dbPath), { recursive: true });
  await sqlite(dbPath, `
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
  return { dbPath };
}

export async function hasProcessedItem(store: ProcessedStore, item: DedupItem): Promise<boolean> {
  const id = normalize(item.id);
  const url = normalizeUrl(item.url || item.sourceUrl);
  const hash = contentHash(item);
  const predicates = [
    id ? `item_id = ${sqlString(id)}` : "",
    url ? `url = ${sqlString(url)}` : "",
    `content_hash = ${sqlString(hash)}`,
  ].filter(Boolean).join(" OR ");
  const stdout = await sqlite(store.dbPath, `SELECT rowid FROM processed_items WHERE ${predicates} LIMIT 1;`, true);
  const rows = stdout ? JSON.parse(stdout) as unknown[] : [];
  return rows.length > 0;
}

export async function filterUnprocessed<T extends DedupItem>(store: ProcessedStore, items: T[]): Promise<FilterResult<T>> {
  const fresh: T[] = [];
  const skipped: T[] = [];
  for (const item of items) {
    if (await hasProcessedItem(store, item)) skipped.push(item);
    else fresh.push(item);
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
  const statements = items.map((item) => {
    const id = normalize(item.id);
    const url = normalizeUrl(item.url || item.sourceUrl);
    return `INSERT OR IGNORE INTO processed_items (
      item_id, url, content_hash, title, author, source,
      first_seen_at, processed_at, report_date, source_created_at, source_updated_at
    ) VALUES (
      ${sqlString(id)},
      ${sqlString(url)},
      ${sqlString(contentHash(item))},
      ${sqlString(normalize(item.title) || "Untitled")},
      ${sqlString(normalize(item.author))},
      ${sqlString(item.source)},
      ${sqlString(processedAt)},
      ${sqlString(processedAt)},
      ${sqlString(reportDate)},
      ${sqlString(item.createdAt)},
      ${sqlString(item.updatedAt)}
    );`;
  }).join("\n");
  await sqlite(store.dbPath, `BEGIN IMMEDIATE;\n${statements}\nCOMMIT;`);
}
