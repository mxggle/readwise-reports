import type { DedupItem } from "../../_sdk/index.js";

// ============================================================================
// Shared types and small pure helpers for the HN digest skill.
// ============================================================================

export type CategoryId = "ai-ml" | "security" | "engineering" | "tools" | "opinion" | "other";

/** Health of AI scoring: ok = all batches scored, partial = some failed, failed = all fell back to defaults. */
export type AiStatus = "ok" | "partial" | "failed";

/** Classify AI scoring health from per-batch failure counts. */
export function computeAiStatus(failedBatches: number, totalBatches: number): AiStatus {
  if (totalBatches === 0 || failedBatches === 0) return "ok";
  if (failedBatches >= totalBatches) return "failed";
  return "partial";
}

export const CATEGORY_META: Record<CategoryId, { emoji: string; label: string }> = {
  "ai-ml": { emoji: "🤖", label: "AI / ML" },
  security: { emoji: "🔒", label: "Security" },
  engineering: { emoji: "⚙️", label: "Engineering" },
  tools: { emoji: "🛠", label: "Tools / Open Source" },
  opinion: { emoji: "💡", label: "Opinion / Essays" },
  other: { emoji: "📝", label: "Other" },
};

export interface Article {
  title: string;
  link: string;
  pubDate: Date;
  description: string;
  sourceName: string;
  sourceUrl: string;
}

/** An article carrying the dedup keys the SkillStore needs, plus the original article. */
export interface DedupableArticle extends DedupItem {
  article: Article;
}

/** Map an article to a dedup record. The article URL is the natural unique key. */
export function toDedupable(a: Article): DedupableArticle {
  return {
    id: a.link,
    url: a.link,
    sourceUrl: a.sourceUrl,
    title: a.title,
    author: a.sourceName,
    source: "hn",
    text: a.description,
    article: a,
  };
}

export interface ScoredArticle extends Article {
  score: number;
  scoreBreakdown: {
    relevance: number;
    quality: number;
    timeliness: number;
  };
  category: CategoryId;
  keywords: string[];
  summary: string;
  reason: string;
}
