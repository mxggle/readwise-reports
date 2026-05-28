import type { SkillContext, SkillResult } from "../_sdk/index.js";
import { runDigest } from "./lib/digest.js";

export default async function run(ctx: SkillContext): Promise<SkillResult> {
  const { config, date, log, ai, writer } = ctx;
  const lookbackHours = config.schedule?.lookbackHours ?? 48;
  const maxItems = config.digest?.maxItems ?? 15;

  log.info(`Generating ${config.title} for ${date} (last ${lookbackHours}h, top ${maxItems})...`);

  const { markdown, stats } = await runDigest({ ai, lookbackHours, maxItems, date });

  const outputPath = await writer.writeReport(markdown);
  log.info(`Wrote ${outputPath}`);

  return {
    itemsProcessed: stats.selectedCount,
    itemsSkipped: 0,
    outputPath,
  };
}
