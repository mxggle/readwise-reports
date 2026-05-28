import { execa } from "execa";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import type { SkillContext, SkillResult } from "../../scripts/src/kernel/types.js";

export default async function run(ctx: SkillContext): Promise<SkillResult> {
  const { config, date, log } = ctx;
  const lookbackHours = config.schedule?.lookbackHours ?? 48;
  const maxItems = config.digest?.maxItems ?? 15;
  const outputDir = config.output?.dir ?? `docs/${config.id}`;
  const outputPath = path.join(outputDir, `${date}.md`);
  const scriptPath = path.join("skills", "hn", "lib", "digest.ts");

  await mkdir(outputDir, { recursive: true });
  log.info(`Generating ${config.title} for ${date} (last ${lookbackHours}h, top ${maxItems})...`);

  await execa(
    "npx",
    ["-y", "bun", scriptPath, "--hours", String(lookbackHours), "--top-n", String(maxItems), "--output", outputPath],
    { stdio: "inherit" },
  );

  log.info(`Wrote ${outputPath}`);

  return {
    itemsProcessed: maxItems,
    itemsSkipped: 0,
    outputPath,
  };
}
