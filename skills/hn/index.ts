import type { NotificationPayload, SkillContext, SkillResult } from "../_sdk/index.js";
import { runDigest } from "./lib/digest.js";

export default async function run(ctx: SkillContext): Promise<SkillResult> {
  const { config, date, log, ai, writer, publicSiteUrl } = ctx;
  const lookbackHours = config.schedule?.lookbackHours ?? 48;
  const maxItems = config.digest?.maxItems ?? 15;

  log.info(`Generating ${config.title} for ${date} (last ${lookbackHours}h, top ${maxItems})...`);

  const { markdown, stats, topArticles } = await runDigest({ ai, lookbackHours, maxItems, date });

  const outputPath = await writer.writeReport(markdown);
  log.info(`Wrote ${outputPath}`);

  if (stats.aiStatus !== "ok") {
    log.warn(`AI scoring ${stats.aiStatus} — report marked as degraded.`);
  }

  const notifications = buildNotifications(config.notification?.channels ?? [], config.title, date, topArticles, publicSiteUrl, config.id, stats.aiStatus);

  return {
    itemsProcessed: stats.selectedCount,
    itemsSkipped: 0,
    outputPath,
    notifications,
  };
}

function buildNotifications(
  channels: string[],
  title: string,
  date: string,
  topArticles: Array<{ title: string; sourceName: string; link: string; category: string }>,
  publicSiteUrl: string | undefined,
  skillId: string,
  aiStatus: "ok" | "partial" | "failed",
): NotificationPayload[] | undefined {
  if (channels.length === 0) return undefined;
  const top3 = topArticles.slice(0, 3);
  const listing = top3.length
    ? top3.map((a, i) => `${i + 1}. ${a.title} — ${a.sourceName}`).join("\n")
    : "No standout articles today.";
  const warning =
    aiStatus === "failed"
      ? "⚠️ Degraded: AI scoring failed — rankings are placeholder defaults.\n\n"
      : aiStatus === "partial"
        ? "⚠️ Partial: some AI scoring failed — rankings may be unreliable.\n\n"
        : "";
  const titleSuffix = aiStatus !== "ok" ? " ⚠️" : "";
  const url = publicSiteUrl ? `${publicSiteUrl}/${skillId}/${date}/` : undefined;
  return channels.map((channel) => ({
    channel,
    title: `${title} Daily｜${date}${titleSuffix}`,
    body: `${warning}${listing}`,
    url,
  }));
}
