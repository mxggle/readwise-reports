import { execa } from "execa";
import type { Logger } from "../../_sdk/index.js";
import type { SourceItem } from "./types.js";

/** Minimal sink for non-fatal fetch warnings; the skill passes its `ctx.log`. */
type WarnLog = Pick<Logger, "warn">;

const readwiseToken = () => process.env.READWISE_TOKEN || "";
const readwiseUseCli = () => (process.env.READWISE_USE_CLI || "true") !== "false";

// Safety cap on page walks. At 100 items/page this is ~10k items; a daily
// updatedAfter window is far smaller, so this only guards against a stuck cursor.
const MAX_PAGES = 100;
const PAGE_SIZE = 100;

const READER_FIELDS =
  "title,author,source,category,location,tags,site_name,word_count,reading_time,created_at,updated_at,published_date,summary,url,source_url,saved_at,parent_id,content,html_content";

// Highlight fields for the CLI list path. Requesting book_* fields enriches each
// highlight with its parent book's metadata in the same request (no N+1 lookups).
const HIGHLIGHT_FIELDS =
  "text,note,url,color,updated,highlighted_at,book_id,tags,book_title,book_author,book_source_url,book_tags";

/** Tags arrive either as arrays (of strings or {name}) or as keyed objects; normalize both. */
function normalizeTags(...sources: any[]): string[] {
  const out: string[] = [];
  for (const src of sources) {
    if (Array.isArray(src)) {
      for (const t of src) out.push(typeof t === "string" ? t : t?.name);
    } else if (src && typeof src === "object") {
      out.push(...Object.keys(src));
    }
  }
  return out.filter(Boolean);
}

function textFromHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function readerText(d: any): string {
  return textFromHtml(d.html_content || d.content || d.summary || "");
}

function isPlaceholderText(value: string | undefined | null): boolean {
  return /^(comments?|no content|this tweet contains no text)$/i.test((value || "").trim());
}

function readerSummary(value: string | undefined | null): string | undefined {
  const summary = (value || "").trim();
  if (!summary || isPlaceholderText(summary) || summary.length < 80) return undefined;
  return summary;
}

function isReportableReaderDoc(d: any): boolean {
  if (d.parent_id) return false;
  if (d.category === "highlight" || d.category === "note") return false;
  const text = readerText(d);
  if (isPlaceholderText(text)) return false;
  return text.length >= 80;
}

async function readwiseApi(path: string, attempt = 0): Promise<any> {
  const token = readwiseToken();
  if (!token) throw new Error("READWISE_TOKEN missing");
  const res = await fetch(`https://readwise.io${path}`, {
    headers: { Authorization: `Token ${token}` },
  });
  // Readwise rate-limits requests; paginating multiplies the request count, so
  // honour 429 with the server's Retry-After (falling back to exponential backoff).
  if (res.status === 429 && attempt < 5) {
    const retryAfter = Number(res.headers.get("Retry-After")) || 2 ** attempt;
    await new Promise((r) => setTimeout(r, retryAfter * 1000));
    return readwiseApi(path, attempt + 1);
  }
  if (!res.ok) throw new Error(`Readwise API ${res.status}: ${await res.text()}`);
  return res.json();
}

/** Walk every page of a Readwise list/export endpoint, following nextPageCursor. */
async function fetchAllPages(basePath: string): Promise<any[]> {
  const out: any[] = [];
  let cursor: string | undefined;
  let pages = 0;
  do {
    const sep = basePath.includes("?") ? "&" : "?";
    const url = cursor ? `${basePath}${sep}pageCursor=${encodeURIComponent(cursor)}` : basePath;
    const data = await readwiseApi(url);
    const results = Array.isArray(data?.results) ? data.results : Array.isArray(data) ? data : [];
    out.push(...results);
    const next: string | undefined = data?.nextPageCursor || undefined;
    cursor = next === cursor ? undefined : next; // stop if the cursor stops advancing
  } while (cursor && ++pages < MAX_PAGES);
  return out;
}

export async function fetchHighlights(updatedAfter: string, log?: WarnLog): Promise<SourceItem[]> {
  if (readwiseToken()) {
    const books = await fetchAllPages(`/api/v2/export/?updatedAfter=${encodeURIComponent(updatedAfter)}`);
    return books.flatMap(mapExportBook);
  }

  // No token → fall back to the local CLI (the readwise skill's default mode).
  if (!readwiseUseCli()) return [];
  try {
    const highlights = await fetchHighlightsViaCli(updatedAfter);
    return highlights.map(mapCliHighlight);
  } catch (error) {
    log?.warn(`Highlights CLI fetch failed: ${error instanceof Error ? error.message : String(error)}`);
    return [];
  }
}

/** Map one book from the v2 export response (highlights nested under the book). */
function mapExportBook(book: any): SourceItem[] {
  return (book.highlights || []).map((h: any) => ({
    id: `h-${h.id}`,
    title: book.title || "Untitled highlight",
    author: book.author,
    url: h.url || book.source_url,
    sourceUrl: book.source_url,
    source: "readwise-highlight" as const,
    text: h.text || "",
    summary: h.note || undefined,
    createdAt: h.created_at,
    updatedAt: h.updated_at,
    tags: normalizeTags(book.tags, h.tags),
  }));
}

/** Map one flat highlight from the CLI list path (book metadata inlined as book_*). */
function mapCliHighlight(h: any): SourceItem {
  return {
    id: `h-${h.id}`,
    title: h.book_title || "Untitled highlight",
    author: h.book_author,
    url: h.url || h.book_source_url,
    sourceUrl: h.book_source_url,
    source: "readwise-highlight",
    text: h.text || "",
    summary: h.note || undefined,
    createdAt: h.highlighted_at,
    updatedAt: h.updated,
    tags: normalizeTags(h.book_tags, h.tags),
  };
}

/** Page through Readwise highlights via the local CLI. This path uses page numbers. */
async function fetchHighlightsViaCli(updatedAfter: string): Promise<any[]> {
  const out: any[] = [];
  let page = 1;
  while (page <= MAX_PAGES) {
    const { stdout } = await execa("readwise", [
      "readwise-list-highlights",
      "--updated-gt", updatedAfter,
      "--page-size", String(PAGE_SIZE),
      "--page", String(page),
      "--response-fields", HIGHLIGHT_FIELDS,
      "--json",
    ]);
    const data = JSON.parse(stdout);
    const results = Array.isArray(data?.results) ? data.results : [];
    out.push(...results);
    if (!data?.next || results.length === 0) break; // `next` is null on the last page
    page++;
  }
  return out;
}

function mapReaderDoc(d: any): SourceItem {
  const text = readerText(d);
  const summary = readerSummary(d.summary);
  return {
    id: `r-${d.id}`,
    title: d.title || "Untitled Reader document",
    author: d.author,
    url: d.url || `https://read.readwise.io/read/${d.id}`,
    sourceUrl: d.source_url,
    source: "reader-document",
    category: d.category,
    location: d.location,
    text,
    summary,
    createdAt: d.created_at || d.saved_at,
    updatedAt: d.updated_at,
    publishedDate: d.published_date,
    tags: normalizeTags(d.tags),
    wordCount: d.word_count,
  };
}

/** Page through Reader documents via the local CLI, following nextPageCursor. */
async function fetchReaderDocsViaCli(updatedAfter: string): Promise<any[]> {
  const out: any[] = [];
  let cursor: string | undefined;
  let pages = 0;
  do {
    const args = [
      "reader-list-documents",
      "--updated-after", updatedAfter,
      "--limit", String(PAGE_SIZE),
      "--response-fields", READER_FIELDS,
      "--json",
    ];
    if (cursor) args.push("--page-cursor", cursor);
    const { stdout } = await execa("readwise", args);
    const data = JSON.parse(stdout);
    const results = Array.isArray(data?.results) ? data.results : [];
    out.push(...results);
    const next: string | undefined = data?.nextPageCursor || undefined;
    cursor = next === cursor ? undefined : next;
  } while (cursor && ++pages < MAX_PAGES);
  return out;
}

export async function fetchReaderDocuments(updatedAfter: string, log?: WarnLog): Promise<SourceItem[]> {
  if (readwiseToken()) {
    const results = await fetchAllPages(`/api/v3/list/?updatedAfter=${encodeURIComponent(updatedAfter)}&limit=${PAGE_SIZE}&withHtmlContent=true`);
    return results.filter(isReportableReaderDoc).map(mapReaderDoc);
  }

  if (!readwiseUseCli()) return [];
  try {
    const results = await fetchReaderDocsViaCli(updatedAfter);
    return results.filter(isReportableReaderDoc).map(mapReaderDoc);
  } catch (error) {
    log?.warn(`Reader CLI fetch failed: ${error instanceof Error ? error.message : String(error)}`);
    return [];
  }
}

/**
 * Collapse exact duplicates within a single fetch batch, keyed on the stable
 * per-item id (`h-<id>` / `r-<id>`).
 *
 * We deliberately do NOT key on title|author: every highlight from the same book
 * carries the book's title and author, so a title|author key would drop all but
 * one highlight per book. Real cross-source / cross-day dedup (by url and content
 * hash) is the processed-store's job — this step only removes accidental repeats
 * of the very same item in one fetch.
 */
export function dedupe(items: SourceItem[]) {
  const seen = new Set<string>();
  const out: SourceItem[] = [];
  for (const item of items) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    out.push(item);
  }
  return out;
}
