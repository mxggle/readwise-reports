import { pathToFileURL } from "node:url";
import type { SkillEntry } from "./registry.js";
import type { SkillContext, SkillPaths, SkillResult } from "./types.js";
import { env } from "./env.js";
import { buildAiClient } from "./services/ai.js";
import { consoleLogger } from "./services/logger.js";
import { buildStore } from "./services/store.js";
import { buildWriter } from "./services/writer.js";

export interface InvokeOptions {
  date: string;
  dryRun: boolean;
}

export async function invokeSkill(entry: SkillEntry, opts: InvokeOptions): Promise<SkillResult> {
  const { manifest } = entry;
  for (const v of manifest.env?.required ?? []) {
    if (!process.env[v]) {
      throw new Error(`Skill "${manifest.id}" requires env var ${v}`);
    }
  }

  const paths: SkillPaths = {
    outputDir: `docs/${manifest.id}`,
    rawDir: `generated/raw/${manifest.id}`,
    generatedDir: "generated",
  };

  const ctx: SkillContext = {
    config: manifest,
    ai: buildAiClient(manifest),
    log: consoleLogger(manifest.id),
    dryRun: opts.dryRun,
    date: opts.date,
    timezone: manifest.schedule?.timezone ?? env.timezone,
    paths,
    writer: buildWriter(opts.date, paths),
    store: buildStore(env.processedDbPath, opts.date, opts.dryRun),
    publicSiteUrl: env.publicSiteUrl || undefined,
  };

  const mod = await import(pathToFileURL(entry.entryPath).href);
  if (typeof mod.default !== "function") {
    throw new Error(`Skill "${manifest.id}" does not export a default function`);
  }
  return (await mod.default(ctx)) as SkillResult;
}
