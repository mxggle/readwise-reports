import { pathToFileURL } from "node:url";
import type { SkillEntry } from "./registry.js";
import type { SkillContext, SkillResult } from "./types.js";
import { buildAiClient } from "./services/ai.js";
import { consoleLogger } from "./services/logger.js";

export interface InvokeOptions {
  date: string;
  dryRun: boolean;
}

export async function invokeSkill(entry: SkillEntry, opts: InvokeOptions): Promise<SkillResult> {
  const required = entry.manifest.env?.required ?? [];
  for (const v of required) {
    if (!process.env[v]) {
      throw new Error(`Skill "${entry.manifest.id}" requires env var ${v}`);
    }
  }

  const ctx: SkillContext = {
    config: entry.manifest,
    ai: buildAiClient(entry.manifest),
    log: consoleLogger(entry.manifest.id),
    dryRun: opts.dryRun,
    date: opts.date,
  };

  const mod = await import(pathToFileURL(entry.entryPath).href);
  if (typeof mod.default !== "function") {
    throw new Error(`Skill "${entry.manifest.id}" does not export a default function`);
  }

  return (await mod.default(ctx)) as SkillResult;
}
