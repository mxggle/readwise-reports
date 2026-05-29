import path from "node:path";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { SkillContext } from "../../_sdk/index.js";
import type { ArticleAnalysis, ClassifiedItem } from "./types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

type RawEntry = {
  idx: number;
  synopsis: string;
  keyPoints: string[];
  novelAngles: string[];
  verdict: string;
};

export async function analyzeItems(
  ctx: SkillContext,
  items: ClassifiedItem[],
  lang: string,
): Promise<ClassifiedItem[]> {
  const toAnalyze = items
    .filter((i) => i.action === "READ" || i.action === "SKIM")
    .slice(0, 8);
  if (toAnalyze.length === 0) return items;

  try {
    const template = await readFile(
      path.join(__dirname, "..", "prompts", `article-analysis.${lang}.md`),
      "utf8",
    );
    const articlesText = toAnalyze
      .map((item, idx) => {
        const content = (item.summary || item.text).slice(0, 1200);
        return `[${idx}] 标题: ${item.title}\n作者: ${item.author || "Unknown"}\n内容:\n${content}`;
      })
      .join("\n\n---\n\n");

    const prompt = template.replace("{{articles}}", articlesText);
    const raw = await ctx.ai.complete(prompt, { temperature: 0.2, maxTokens: 4000 });
    const entries = parseEntries(raw);

    if (entries.length === 0) {
      ctx.log.warn(`Per-article analysis: AI returned no parseable entries (${raw.length} chars) — skipping enrichment.`);
    } else if (entries.length < toAnalyze.length) {
      ctx.log.warn(`Per-article analysis: only ${entries.length}/${toAnalyze.length} articles enriched.`);
    }

    const analysisMap = new Map<number, ArticleAnalysis>(
      entries.map((e) => [e.idx, { synopsis: e.synopsis, keyPoints: e.keyPoints, novelAngles: e.novelAngles, verdict: e.verdict }]),
    );

    const enriched = new Map<string, ArticleAnalysis>(
      toAnalyze.map((item, idx) => [item.id, analysisMap.get(idx)!]).filter(([, v]) => v != null) as [string, ArticleAnalysis][],
    );

    return items.map((item) => {
      const analysis = enriched.get(item.id);
      return analysis ? { ...item, aiAnalysis: analysis } : item;
    });
  } catch (err) {
    ctx.log.warn(`Per-article analysis failed: ${err instanceof Error ? err.message : String(err)}`);
    return items;
  }
}

function parseEntries(raw: string): RawEntry[] {
  const cleaned = raw.replace(/^```(?:json)?\s*/m, "").replace(/\s*```\s*$/m, "").trim();
  try {
    const parsed: unknown = JSON.parse(cleaned);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isRawEntry);
  } catch {
    return [];
  }
}

function isRawEntry(v: unknown): v is RawEntry {
  if (typeof v !== "object" || v === null) return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r.idx === "number" &&
    typeof r.synopsis === "string" &&
    Array.isArray(r.keyPoints) &&
    Array.isArray(r.novelAngles) &&
    typeof r.verdict === "string"
  );
}
