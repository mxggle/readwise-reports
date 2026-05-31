import type { DedupItem } from "../../_sdk/index.js";

// A note.com article as returned by the hashtag listing API (metadata only).
export interface RawNote {
  key: string; // stable note id, e.g. "nd5000f0d8981"
  title: string;
  authorName: string;
  authorUrlname: string;
  likeCount: number;
  publishAt: string; // ISO 8601 with +09:00 offset
  price: number; // 0 == free
  canReadAll: boolean; // whether the full body is readable without purchase
  url: string; // canonical https://note.com/{urlname}/n/{key}
  hashtags: string[]; // every tracked tag this note surfaced under
}

// A selected note enriched with its full body, converted from HTML to markdown.
export interface NoteArticle extends RawNote {
  bodyMarkdown: string;
  bodyTruncated: boolean;
}

export type AIStatus = "ok" | "partial" | "failed";

// An article after AI processing: Chinese summary + N3–N2 Japanese rewrite.
export interface ProcessedArticle extends NoteArticle {
  summaryZh: string | null;
  rewriteJa: string | null;
  aiStatus: AIStatus;
}

// Map a note to the kernel's dedup shape (keyed on `id`, see skill.json dedup).
export function toDedupItem(note: RawNote): DedupItem {
  return {
    id: note.key,
    title: note.title,
    source: "note.com",
    text: "",
    url: note.url,
    author: note.authorName,
    createdAt: note.publishAt,
  };
}
