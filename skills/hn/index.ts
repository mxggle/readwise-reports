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

  const notifications = buildNotifications(config.notification?.channels ?? [], config.title, date, topArticles, publicSiteUrl, config.id);

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
): NotificationPayload[] | undefined {
  if (channels.length === 0) return undefined;
  const top3 = topArticles.slice(0, 3);
  const body = top3.length
    ? top3.map((a, i) => `${i + 1}. ${a.title} — ${a.sourceName}`).join("\n")
    : "No standout articles today.";
  const url = publicSiteUrl ? `${publicSiteUrl}/${skillId}/${date}/` : undefined;
  return channels.map((channel) => ({
    channel,
    title: `${title} Daily｜${date}`,
    body,
    url,
  }));
}
