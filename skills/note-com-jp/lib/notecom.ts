import type { Logger } from "../../_sdk/index.js";
import type { RawNote } from "./types.js";

// ============================================================================
// Constants
// ============================================================================

const FETCH_TIMEOUT_MS = 15_000;
const FETCH_CONCURRENCY = 6;

// AI tech hashtags tracked on note.com. Edit this list to change coverage —
// each tag is queried and the results merged/deduped/ranked downstream.
export const HASHTAGS: string[] = ["生成AI", "LLM", "AIエージェント", "ChatGPT"];

// Per hashtag we pull two listings and union them: `popular` surfaces the
// genuinely high-signal notes (but skews older), while `new` guarantees enough
// notes inside the 24h window. Ranking the union by likes recovers "what got
// popular in the last day". Two pages each widens the recent pool.
const LISTINGS: Array<{ order: "popular" | "new"; page: number }> = [
  { order: "popular", page: 1 },
  { order: "popular", page: 2 },
  { order: "new", page: 1 },
  { order: "new", page: 2 },
];

const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

// ============================================================================
// API client
// ============================================================================

async function getJson(url: string): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": BROWSER_UA, Accept: "application/json" },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timeout);
  }
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

// Map one raw note object from the hashtag listing into our RawNote shape.
function mapNote(raw: unknown, hashtag: string): RawNote | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const key = asString(r.key);
  const title = asString(r.name).trim();
  if (!key || !title) return null;

  const user = (typeof r.user === "object" && r.user !== null ? r.user : {}) as Record<string, unknown>;
  const urlname = asString(user.urlname);
  const authorName = asString(user.nickname) || asString(user.name) || urlname || "note";
  const price = asNumber(r.price);
  const canReadAll = typeof r.can_read_note_all === "boolean" ? r.can_read_note_all : price === 0;

  return {
    key,
    title,
    authorName,
    authorUrlname: urlname,
    likeCount: asNumber(r.like_count),
    publishAt: asString(r.publish_at),
    price,
    canReadAll,
    url: urlname ? `https://note.com/${urlname}/n/${key}` : `https://note.com/notes/${key}`,
    hashtags: [hashtag],
  };
}

// Fetch one listing (hashtag × order × page). Failures are logged and yield [].
async function fetchListing(
  hashtag: string,
  order: "popular" | "new",
  page: number,
  log: Logger,
): Promise<RawNote[]> {
  const url = `https://note.com/api/v3/hashtags/${encodeURIComponent(hashtag)}/notes?order=${order}&page=${page}`;
  try {
    const json = await getJson(url);
    const data = (typeof json === "object" && json !== null ? (json as Record<string, unknown>).data : null) as
      | Record<string, unknown>
      | null;
    return asArray(data?.notes)
      .map((n) => mapNote(n, hashtag))
      .filter((n): n is RawNote => n !== null);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    log.warn(`✗ #${hashtag} ${order} p${page}: ${msg.includes("abort") ? "timeout" : msg}`);
    return [];
  }
}

// Fetch the popular + new listings for every tracked hashtag, in
// bounded-concurrency batches, and return the flat (un-deduped) union.
export async function fetchTrendingNotes(hashtags: string[], log: Logger): Promise<RawNote[]> {
  const jobs = hashtags.flatMap((hashtag) =>
    LISTINGS.map(({ order, page }) => ({ hashtag, order, page })),
  );

  const all: RawNote[] = [];
  for (let i = 0; i < jobs.length; i += FETCH_CONCURRENCY) {
    const batch = jobs.slice(i, i + FETCH_CONCURRENCY);
    const results = await Promise.allSettled(
      batch.map((j) => fetchListing(j.hashtag, j.order, j.page, log)),
    );
    for (const r of results) {
      if (r.status === "fulfilled") all.push(...r.value);
    }
  }
  log.info(`Fetched ${all.length} note entries (${jobs.length} listings across ${hashtags.length} hashtags)`);
  return all;
}

// Fetch a single note's full body HTML via the note detail endpoint.
export async function fetchNoteBodyHtml(key: string, log: Logger): Promise<string> {
  const url = `https://note.com/api/v3/notes/${encodeURIComponent(key)}`;
  try {
    const json = await getJson(url);
    const data = (typeof json === "object" && json !== null ? (json as Record<string, unknown>).data : null) as
      | Record<string, unknown>
      | null;
    return asString(data?.body);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    log.warn(`✗ body ${key}: ${msg.includes("abort") ? "timeout" : msg}`);
    return "";
  }
}

// ============================================================================
// HTML → Markdown
// ============================================================================

function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(parseInt(code, 10)))
    .replace(/&amp;/g, "&");
}

function getAttr(tag: string, name: string): string {
  const m = tag.match(new RegExp(`${name}=["']([^"']*)["']`, "i"));
  return m ? m[1] : "";
}

// Convert note.com article body HTML into readable markdown. note's editor
// emits well-formed blocks (<p>, <h2>/<h3>, lists, <blockquote>, <figure>),
// so a sequential block-level rewrite is sufficient and predictable.
export function htmlToMarkdown(html: string): string {
  if (!html) return "";
  let out = html;

  // Drop non-content tags entirely.
  out = out.replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, "");

  // Images (incl. those wrapped in <figure>): keep as markdown images.
  out = out.replace(/<img\b[^>]*>/gi, (tag) => {
    const src = getAttr(tag, "src");
    const alt = getAttr(tag, "alt");
    return src ? `\n\n![${alt}](${src})\n\n` : "";
  });
  out = out.replace(/<figcaption[^>]*>([\s\S]*?)<\/figcaption>/gi, (_m, inner: string) => `\n*${inner.trim()}*\n`);
  out = out.replace(/<\/?figure[^>]*>/gi, "\n\n");

  // Headings.
  out = out.replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_m, level: string, inner: string) => {
    const hashes = "#".repeat(Math.min(6, parseInt(level, 10) + 1)); // shift down one level under article H2
    return `\n\n${hashes} ${inner.trim()}\n\n`;
  });

  // Inline emphasis / code / links.
  out = out.replace(/<(strong|b)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_m, _t, inner: string) => `**${inner.trim()}**`);
  out = out.replace(/<(em|i)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_m, _t, inner: string) => `*${inner.trim()}*`);
  out = out.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, (_m, inner: string) => `\`${inner.trim()}\``);
  out = out.replace(/<a\b[^>]*>([\s\S]*?)<\/a>/gi, (tag, inner: string) => {
    const href = getAttr(tag, "href");
    const label = inner.trim();
    return href ? `[${label}](${href})` : label;
  });

  // Lists.
  out = out.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_m, inner: string) => `\n- ${inner.trim()}`);
  out = out.replace(/<\/?(ul|ol)[^>]*>/gi, "\n");

  // Blockquotes.
  out = out.replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi, (_m, inner: string) => {
    const lines = inner.replace(/<[^>]+>/g, "").trim().split(/\n+/);
    return `\n\n${lines.map((l) => `> ${l.trim()}`).join("\n")}\n\n`;
  });

  // Block separators.
  out = out.replace(/<br\s*\/?>/gi, "\n");
  out = out.replace(/<\/p>/gi, "\n\n");
  out = out.replace(/<p[^>]*>/gi, "");

  // Strip any remaining tags, decode entities, normalise whitespace.
  out = out.replace(/<[^>]+>/g, "");
  out = decodeEntities(out);
  out = out
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();

  return out;
}
