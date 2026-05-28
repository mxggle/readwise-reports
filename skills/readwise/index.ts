import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { SkillContext, SkillResult } from "../_sdk/index.js";
import { isoHoursAgo } from "../_sdk/index.js";
import type { ClassifiedItem, ReportData } from "./lib/types.js";
import { classify, keywords } from "./lib/classify.js";
import { renderDaily } from "./lib/markdown.js";
import { dedupe, fetchHighlights, fetchReaderDocuments } from "./lib/readwise-api.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default async function run(ctx: SkillContext): Promise<SkillResult> {
  const { config, date, log, writer, store, timezone } = ctx;
  const lookbackHours = config.schedule?.lookbackHours ?? 24;
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
  const deduped = dedupe([...highlights, ...readerDocs]);
  const { fresh, skipped } = await store.filterUnprocessed(deduped);
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

  await writer.writeRaw(data);
  const outputPath = await writer.writeReport(renderDaily(data));
  log.info(`Wrote ${outputPath}`);

  await store.markProcessed(fresh);
  if (ctx.dryRun) {
    log.info("Dry run: dedup state was not updated.");
  } else {
    log.info(`Recorded ${fresh.length} processed items.`);
  }

  const notifications = buildNotifications(ctx, items, data.keywords);

  return {
    itemsProcessed: fresh.length,
    itemsSkipped: skipped.length,
    outputPath,
    notifications,
  };
}

function buildNotifications(ctx: SkillContext, items: ClassifiedItem[], keywordsList: string[]) {
  const channels = ctx.config.notification?.channels ?? [];
  if (channels.length === 0) return undefined;

  const top = items.filter((i) => i.action === "READ").slice(0, 3);
  const body = [
    `${items.length} 条内容，${top.length} 条优先读。`,
    top[0] ? `Top 1：${top[0].title}` : "今天没有明显 S 级内容。",
    `关键词：${keywordsList.slice(0, 5).join(" / ") || "暂无"}`,
  ].join("\n");
  const url = ctx.publicSiteUrl ? `${ctx.publicSiteUrl}/${ctx.config.id}/${ctx.date}/` : undefined;
  const title = `${ctx.config.title} Daily｜${ctx.date}`;
  return channels.map((channel) => ({ channel, title, body, url }));
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
