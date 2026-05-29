import "dotenv/config";
import { mkdir, readFile, writeFile, unlink, readdir, rename, watch } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { callProvider, isProviderId, type ProviderId } from "./kernel/services/providers.js";

const TASK_DIR = "generated/agent-tasks";
const RESULT_DIR = "generated/agent-results";

interface AgentTask {
  version: number;
  taskId: string;
  skill: string;
  prompt: string;
  system?: string;
  opts?: { maxTokens?: number; temperature?: number };
  resultFile: string;
}

function detectProvider(): ProviderId {
  if (process.env.ANTHROPIC_API_KEY) return "anthropic";
  if (process.env.OPENAI_API_KEY) return "openai";
  if (process.env.DEEPSEEK_API_KEY) return "deepseek";
  if (process.env.GEMINI_API_KEY) return "gemini";
  throw new Error("No AI provider available. Set ANTHROPIC_API_KEY, OPENAI_API_KEY, DEEPSEEK_API_KEY, or GEMINI_API_KEY.");
}

/** Honour an explicit WATCHER_PROVIDER (rejecting unknown values), else auto-detect. */
function resolveProvider(): ProviderId {
  const raw = process.env.WATCHER_PROVIDER;
  if (raw === undefined || raw === "") return detectProvider();
  if (!isProviderId(raw)) throw new Error(`Unknown WATCHER_PROVIDER: ${raw}`);
  return raw;
}

async function callAI(task: AgentTask): Promise<string> {
  const provider = resolveProvider();
  const { prompt, system, opts } = task;
  // WATCHER_MODEL overrides the provider's default model; callProvider falls back
  // to the provider's *_MODEL env / built-in default when it is unset.
  return callProvider(provider, prompt, { system, maxTokens: opts?.maxTokens, temperature: opts?.temperature }, process.env.WATCHER_MODEL);
}

async function atomicWrite(targetPath: string, data: unknown): Promise<void> {
  const tmp = `${targetPath}.tmp-${randomUUID()}`;
  await writeFile(tmp, JSON.stringify(data, null, 2));
  await rename(tmp, targetPath);
}

/**
 * Atomically claim a task by renaming it out of the way before processing.
 * rename() is atomic on a single filesystem, so if two watchers race only one
 * succeeds — the loser gets ENOENT and skips. The `.processing-<pid>` suffix
 * does not end in `.json`, so it is invisible to other watchers and to the
 * host-agent `agent:tasks list` helper.
 */
async function claimTask(taskFile: string): Promise<string | null> {
  const claimed = `${taskFile}.processing-${process.pid}`;
  try {
    await rename(taskFile, claimed);
    return claimed;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null; // taken or gone
    throw err;
  }
}

async function processFile(taskFile: string): Promise<void> {
  const claimed = await claimTask(taskFile);
  if (!claimed) return; // another watcher claimed it, or it disappeared

  let task: AgentTask;
  try {
    task = JSON.parse(await readFile(claimed, "utf8")) as AgentTask;
  } catch {
    await unlink(claimed).catch(() => undefined); // unparseable claim — drop it
    return;
  }

  console.log(`[watcher] processing ${task.skill}/${task.taskId}`);
  await mkdir(RESULT_DIR, { recursive: true });

  try {
    const completion = await callAI(task);
    await atomicWrite(task.resultFile, { completion });
    console.log(`[watcher] done ${task.skill}/${task.taskId}`);
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    await atomicWrite(task.resultFile, { error });
    console.error(`[watcher] error ${task.skill}/${task.taskId}: ${error}`);
  }

  await unlink(claimed).catch(() => undefined);
}

async function main(): Promise<void> {
  await mkdir(TASK_DIR, { recursive: true });
  await mkdir(RESULT_DIR, { recursive: true });

  const provider = resolveProvider();
  console.log(`[watcher] starting — provider: ${provider}`);
  console.log(`[watcher] watching ${TASK_DIR}`);

  // drain any tasks left over from before startup
  const existing = await readdir(TASK_DIR);
  for (const name of existing) {
    if (name.endsWith(".json") && !name.includes(".tmp-")) {
      await processFile(path.join(TASK_DIR, name));
    }
  }

  const watcher = watch(TASK_DIR);
  for await (const event of watcher) {
    const { filename } = event;
    if (filename && filename.endsWith(".json") && !filename.includes(".tmp-")) {
      await processFile(path.join(TASK_DIR, filename));
    }
  }
}

main().catch((err) => {
  console.error("[watcher] fatal:", err);
  process.exit(1);
});
