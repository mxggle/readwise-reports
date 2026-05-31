import path from "node:path";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { SkillContext } from "../../_sdk/index.js";
import type { AIStatus, NoteArticle, ProcessedArticle } from "./types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const ARTICLE_CONCURRENCY = 3;
// Bound the body length fed to the model. note articles are usually well under
// this; longer ones are truncated (the rewrite then covers the included part).
const SUMMARY_BODY_CHARS = 6_000;
const REWRITE_BODY_CHARS = 10_000;

async function loadPrompt(name: string): Promise<string> {
  return readFile(path.join(__dirname, "..", "prompts", name), "utf8");
}

function fill(template: string, vars: Record<string, string>): string {
  return Object.entries(vars).reduce(
    (acc, [k, v]) => acc.replaceAll(`{{${k}}}`, v),
    template,
  );
}

// Run an async mapper over items with a fixed concurrency cap, preserving order.
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await fn(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

function statusOf(summaryZh: string | null, rewriteJa: string | null): AIStatus {
  if (summaryZh && rewriteJa) return "ok";
  if (summaryZh || rewriteJa) return "partial";
  return "failed";
}

// For each article, run the Chinese-summary and N3–N2-rewrite calls in parallel.
// Each call fails independently and falls back to null — an AI error never
// aborts the skill (per project convention).
export async function processArticles(
  ctx: SkillContext,
  articles: NoteArticle[],
): Promise<ProcessedArticle[]> {
  if (articles.length === 0) return [];

  const [summaryTpl, rewriteTpl] = await Promise.all([
    loadPrompt("summary.zh-CN.md"),
    loadPrompt("rewrite.ja.md"),
  ]);

  return mapWithConcurrency(articles, ARTICLE_CONCURRENCY, async (article) => {
    const body = article.bodyMarkdown;

    const summaryPromise = ctx.ai
      .complete(
        fill(summaryTpl, {
          title: article.title,
          author: article.authorName,
          body: body.slice(0, SUMMARY_BODY_CHARS),
        }),
        { temperature: 0.3, maxTokens: 1200 },
      )
      .then((t) => t.trim() || null)
      .catch((err) => {
        ctx.log.warn(`summary failed (${article.key}): ${err instanceof Error ? err.message : String(err)}`);
        return null;
      });

    const rewritePromise = ctx.ai
      .complete(
        fill(rewriteTpl, {
          title: article.title,
          body: body.slice(0, REWRITE_BODY_CHARS),
        }),
        { temperature: 0.4, maxTokens: 4000 },
      )
      .then((t) => t.trim() || null)
      .catch((err) => {
        ctx.log.warn(`rewrite failed (${article.key}): ${err instanceof Error ? err.message : String(err)}`);
        return null;
      });

    const [summaryZh, rewriteJa] = await Promise.all([summaryPromise, rewritePromise]);
    return { ...article, summaryZh, rewriteJa, aiStatus: statusOf(summaryZh, rewriteJa) };
  });
}
