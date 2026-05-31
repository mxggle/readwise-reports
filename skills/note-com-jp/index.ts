import type { NotificationPayload, SkillContext, SkillResult } from "../_sdk/index.js";
import { HASHTAGS, fetchNoteBodyHtml, fetchTrendingNotes, htmlToMarkdown } from "./lib/notecom.js";
import { rankCandidates } from "./lib/select.js";
import { processArticles } from "./lib/process.js";
import { renderReport } from "./lib/render.js";
import { toDedupItem, type NoteArticle, type ProcessedArticle, type RawNote } from "./lib/types.js";

const BODY_MARKDOWN_LIMIT = 14_000;

export default async function run(ctx: SkillContext): Promise<SkillResult> {
  const { config, date, timezone, log, writer, store } = ctx;
  const lookbackHours = config.schedule?.lookbackHours ?? 24;
  const maxItems = config.digest?.maxItems ?? 5;

  log.info(`Generating ${config.title} for ${date} (last ${lookbackHours}h, top ${maxItems})...`);

  // 1. Fetch trending notes for every tracked hashtag and rank candidates.
  const rawNotes = await fetchTrendingNotes(HASHTAGS, log);
  const ranked = rankCandidates({ notes: rawNotes, now: new Date(), lookbackHours });
  log.info(`${ranked.length} free candidates within the last ${lookbackHours}h`);

  // 2. Cross-day dedup: skip notes already reported on a previous run.
  const { fresh, skipped } = await store.filterUnprocessed(ranked.map(toDedupItem));
  const freshKeys = new Set(fresh.map((f) => f.id));
  const selected: RawNote[] = ranked.filter((n) => freshKeys.has(n.key)).slice(0, maxItems);
  log.info(`Selected ${selected.length} (skipped ${skipped.length} already-seen)`);

  // 3. Fetch full body for each selected note and convert HTML → markdown.
  const articles: NoteArticle[] = await Promise.all(
    selected.map(async (note) => {
      const html = await fetchNoteBodyHtml(note.key, log);
      const md = htmlToMarkdown(html);
      const truncated = md.length > BODY_MARKDOWN_LIMIT;
      return { ...note, bodyMarkdown: truncated ? md.slice(0, BODY_MARKDOWN_LIMIT) : md, bodyTruncated: truncated };
    }),
  );

  // 4. AI: Chinese summary + N3–N2 Japanese rewrite (parallel, fault-tolerant).
  const processed: ProcessedArticle[] = await processArticles(ctx, articles);

  // 5. Render and write the report.
  const markdown = renderReport({ date, timezone, hashtags: HASHTAGS, articles: processed, skippedCount: skipped.length });
  const outputPath = await writer.writeReport(markdown);
  log.info(`Wrote ${outputPath}`);
  await writer.writeRaw(processed.map(({ bodyMarkdown, ...rest }) => rest));

  // 6. Record processed notes only after a successful write (no-op in dry-run).
  const processedItems = selected.map(toDedupItem);
  await store.markProcessed(processedItems);
  if (ctx.dryRun) {
    log.info("Dry run: dedup state was not updated.");
  } else {
    log.info(`Recorded ${processedItems.length} processed notes.`);
  }

  const degraded = processed.some((a) => a.aiStatus === "failed");
  const notifications = buildNotifications(
    config.notification?.channels ?? [],
    config.title,
    date,
    processed,
    ctx.publicSiteUrl,
    config.id,
    degraded,
  );

  return {
    itemsProcessed: processed.length,
    itemsSkipped: skipped.length,
    outputPath,
    notifications,
  };
}

function buildNotifications(
  channels: string[],
  title: string,
  date: string,
  articles: ProcessedArticle[],
  publicSiteUrl: string | undefined,
  skillId: string,
  degraded: boolean,
): NotificationPayload[] | undefined {
  if (channels.length === 0) return undefined;
  const top3 = articles.slice(0, 3);
  const listing = top3.length
    ? top3.map((a, i) => `${i + 1}. ${a.title} — ❤️ ${a.likeCount}`).join("\n")
    : "今日は新しい記事がありませんでした。";
  const warning = degraded ? "⚠️ 一部の AI 生成に失敗しました。\n\n" : "";
  const url = publicSiteUrl ? `${publicSiteUrl}/${skillId}/${date}/` : undefined;
  return channels.map((channel) => ({
    channel,
    title: `${title}｜${date}`,
    body: `${warning}${listing}`,
    url,
  }));
}
