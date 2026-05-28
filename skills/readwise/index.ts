import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ReportData, SkillContext, SkillResult } from "../../scripts/src/kernel/types.js";
import { isoHoursAgo } from "../../scripts/src/kernel/date.js";
import { filterUnprocessed, markProcessedItems, openProcessedStore } from "../../scripts/src/kernel/processed-store.js";
import { classify, keywords } from "../../scripts/src/kernel/classify.js";
import { summarizeWithAi } from "../../scripts/src/kernel/ai.js";
import { renderDaily } from "../../scripts/src/kernel/markdown.js";
import { env } from "../../scripts/src/kernel/env.js";
import { dedupe, fetchHighlights, fetchReaderDocuments } from "./lib/readwise-api.js";

export default async function run(ctx: SkillContext): Promise<SkillResult> {
  const { config, date, dryRun, log } = ctx;
  const timezone = config.schedule?.timezone ?? "UTC";
  const lookbackHours = config.schedule?.lookbackHours ?? 24;
  const outputDir = config.output?.dir ?? `docs/${config.id}`;

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

  const data: ReportData = {
    date,
    generatedAt: now.toISOString(),
    timezone,
    windowStart,
    windowEnd,
    items,
    keywords: keywords(items),
    aiSummary: await summarizeWithAi(items),
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
