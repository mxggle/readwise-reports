import { Command } from "commander";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { execa } from "execa";
import { env } from "./lib/env.js";
import { formatDate, isoHoursAgo } from "./lib/date.js";
import { fetchHighlights, fetchReaderDocuments, dedupe } from "./lib/readwise.js";
import { classify, keywords } from "./lib/classify.js";
import { summarizeWithAi } from "./lib/ai.js";
import { renderDaily } from "./lib/markdown.js";
import type { ReportData } from "./lib/types.js";

const program = new Command();
program.option("--date <date>", "Report date YYYY-MM-DD").option("--dry-run", "Do not notify Discord");
program.parse();
const opts = program.opts<{ date?: string; dryRun?: boolean }>();

const now = new Date();
const date = opts.date || formatDate(now, env.timezone);
const windowStart = isoHoursAgo(env.lookbackHours, now);
const windowEnd = now.toISOString();

console.log(`Generating Readwise report for ${date}`);
console.log(`Window: ${windowStart} -> ${windowEnd}`);

const [highlights, readerDocs] = await Promise.all([
  fetchHighlights(windowStart),
  fetchReaderDocuments(windowStart),
]);
const items = classify(dedupe([...highlights, ...readerDocs]));
const data: ReportData = {
  date,
  generatedAt: now.toISOString(),
  timezone: env.timezone,
  windowStart,
  windowEnd,
  items,
  keywords: keywords(items),
  aiSummary: await summarizeWithAi(items),
};

await mkdir(path.join("generated", "raw"), { recursive: true });
await writeFile(path.join("generated", "raw", `${date}.json`), JSON.stringify(data, null, 2));

const md = renderDaily(data);
const dailyPath = path.join("docs", "daily", `${date}.md`);
await writeFile(dailyPath, md);
console.log(`Wrote ${dailyPath}`);

await execa("pnpm", ["build:index"], { stdio: "inherit" });

if (!opts.dryRun && env.discordWebhookUrl) {
  const url = env.publicSiteUrl ? `${env.publicSiteUrl}/daily/${date}/` : "";
  const top = items.filter((i) => i.action === "READ").slice(0, 3);
  const summary = [
    `${items.length} 条内容，${top.length} 条优先读。`,
    top[0] ? `Top 1：${top[0].title}` : "今天没有明显 S 级内容。",
    `关键词：${data.keywords.slice(0, 5).join(" / ") || "暂无"}`,
  ].join("\n");
  await execa("pnpm", ["notify", `Readwise Daily｜${date}`, summary, url], { stdio: "inherit" });
}
