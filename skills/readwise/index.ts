import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ClassifiedItem, ReportData, SkillContext, SkillResult } from "../../scripts/src/kernel/types.js";
import { isoHoursAgo } from "../../scripts/src/kernel/date.js";
import { filterUnprocessed, markProcessedItems, openProcessedStore } from "../../scripts/src/kernel/processed-store.js";
import { classify, keywords } from "../../scripts/src/kernel/classify.js";
import { renderDaily } from "../../scripts/src/kernel/markdown.js";
import { env } from "../../scripts/src/kernel/env.js";
import { dedupe, fetchHighlights, fetchReaderDocuments } from "./lib/readwise-api.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default async function run(ctx: SkillContext): Promise<SkillResult> {
  const { config, date, dryRun, log } = ctx;
  const timezone = config.schedule?.timezone ?? "UTC";
  const lookbackHours = config.schedule?.lookbackHours ?? 24;
  const outputDir = config.output?.dir ?? `docs/${config.id}`;
  const lang = config.ai?.outputLanguage ?? "zh-CN";

  const now = new Date();
  const windowStart = isoHoursAgo(lookbackHours, now);
  const windowEnd = now.toISOString();

  log.info(`Generating ${config.title} report for ${date}`);
  log.info(`Window: ${windowStart} -> ${windowEnd}`);

  const [highlights, readerDocs] = await Promise.all([
    fetchHighlights(windowStart),
    fetchReaderDocuments(windowStart),
  ]);
  const store = await openProcessedStore(env.processedDbPath);
  const deduped = dedupe([...highlights, ...readerDocs]);
  const { fresh, skipped } = await filterUnprocessed(store, deduped);
  const items = classify(fresh);
  log.info(`Fetched ${deduped.length} unique items; ${fresh.length} new, ${skipped.length} already processed.`);

  const aiSummary = await summarize(ctx, items, lang, log);

  const data: ReportData = {
    date,
    generatedAt: now.toISOString(),
    timezone,
    windowStart,
    windowEnd,
    items,
    keywords: keywords(items),
    aiSummary,
  };

  await mkdir(path.join("generated", "raw"), { recursive: true });
  await writeFile(path.join("generated", "raw", `${date}.json`), JSON.stringify(data, null, 2));

  const md = renderDaily(data);
  const dailyPath = path.join(outputDir, `${date}.md`);
  await mkdir(path.dirname(dailyPath), { recursive: true });
  await writeFile(dailyPath, md);
  log.info(`Wrote ${dailyPath}`);

  if (!dryRun) {
    await markProcessedItems(store, fresh, date, now.toISOString());
    log.info(`Recorded ${fresh.length} processed items in ${env.processedDbPath}`);
  } else {
    log.info("Dry run: processed-state database was not updated.");
  }

  return {
    itemsProcessed: fresh.length,
    itemsSkipped: skipped.length,
    outputPath: dailyPath,
  };
}

async function summarize(ctx: SkillContext, items: ClassifiedItem[], lang: string, log: SkillContext["log"]): Promise<string> {
  const top = items.filter((i) => i.action !== "IGNORE").slice(0, 8);
  if (top.length === 0) return fallback(top);

  try {
    const template = await readFile(path.join(__dirname, "prompts", `summary.${lang}.md`), "utf8");
    const itemsText = top.map((i, idx) => `${idx + 1}. [${i.topic}][${i.action}] ${i.title}\n${i.summary || i.text.slice(0, 500)}`).join("\n\n");
    const prompt = template.replace("{{items}}", itemsText);
    const text = await ctx.ai.complete(prompt, { temperature: 0.3 });
    return text || fallback(top);
  } catch (err) {
    log.warn(`AI summary failed, using fallback: ${err instanceof Error ? err.message : String(err)}`);
    return fallback(top);
  }
}

function fallback(items: ClassifiedItem[]): string {
  const topics = [...new Set(items.map((i) => i.topic))].join("、") || "阅读";
  const first = items[0]?.title || "暂无高质量内容";
  return `今天的高价值内容集中在 ${topics}。最值得优先处理的是《${first}》。整体建议是少追新闻，多沉淀能服务求职、英语/日语学习和 AI 工程实践的材料。今天只做一件事：读完 Top 1，并写下一个可执行行动。`;
}
