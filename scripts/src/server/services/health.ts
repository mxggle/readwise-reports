import { access } from "node:fs/promises";
import path from "node:path";
import { loadRegistry } from "../../kernel/registry.js";
import { repoRoot } from "../paths.js";

const AI_KEYS = ["OPENAI_API_KEY", "GEMINI_API_KEY", "DEEPSEEK_API_KEY", "ANTHROPIC_API_KEY"] as const;

export interface Health {
  ok: boolean;
  time: string;
  skills: number;
  aiKeys: string[]; // provider env vars that are set
  canGenerate: boolean;
  dedupDb: boolean;
}

export async function getHealth(): Promise<Health> {
  const aiKeys = AI_KEYS.filter((k) => Boolean(process.env[k]));
  const dbPath = process.env.READWISE_PROCESSED_DB || "generated/readwise-processed.sqlite";
  let dedupDb = false;
  try {
    await access(path.isAbsolute(dbPath) ? dbPath : path.join(repoRoot, dbPath));
    dedupDb = true;
  } catch {
    dedupDb = false;
  }
  const skills = (await loadRegistry().catch(() => [])).length;
  return {
    ok: true,
    time: new Date().toISOString(),
    skills,
    aiKeys,
    canGenerate: aiKeys.length > 0,
    dedupDb,
  };
}
