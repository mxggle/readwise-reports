import "dotenv/config";
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { mkdir, readFile, writeFile, unlink, readdir, rename, watch } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";

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

function detectProvider(): "anthropic" | "openai" | "deepseek" | "gemini" {
  if (process.env.ANTHROPIC_API_KEY) return "anthropic";
  if (process.env.OPENAI_API_KEY) return "openai";
  if (process.env.DEEPSEEK_API_KEY) return "deepseek";
  if (process.env.GEMINI_API_KEY) return "gemini";
  throw new Error("No AI provider available. Set ANTHROPIC_API_KEY, OPENAI_API_KEY, DEEPSEEK_API_KEY, or GEMINI_API_KEY.");
}

async function callAI(task: AgentTask): Promise<string> {
  const provider = process.env.WATCHER_PROVIDER ?? detectProvider();
  const messages: { role: "user" | "system"; content: string }[] = [];
  const { prompt, system, opts } = task;

  if (provider === "anthropic") {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const model = process.env.WATCHER_MODEL ?? "claude-sonnet-4-6";
    const res = await client.messages.create({
      model,
      max_tokens: opts?.maxTokens ?? 4096,
      ...(system ? { system } : {}),
      messages: [{ role: "user", content: prompt }],
    });
    const block = res.content[0];
    return block.type === "text" ? block.text.trim() : "";
  }

  if (provider === "openai") {
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const model = process.env.WATCHER_MODEL ?? process.env.OPENAI_MODEL ?? "gpt-4o-mini";
    if (system) messages.push({ role: "system", content: system });
    messages.push({ role: "user", content: prompt });
    const res = await client.chat.completions.create({
      model,
      messages,
      temperature: opts?.temperature ?? 0.3,
      max_tokens: opts?.maxTokens,
    });
    return res.choices[0]?.message?.content?.trim() ?? "";
  }

  if (provider === "deepseek") {
    const client = new OpenAI({ apiKey: process.env.DEEPSEEK_API_KEY, baseURL: "https://api.deepseek.com" });
    const model = process.env.WATCHER_MODEL ?? process.env.DEEPSEEK_MODEL ?? "deepseek-chat";
    if (system) messages.push({ role: "system", content: system });
    messages.push({ role: "user", content: prompt });
    const res = await client.chat.completions.create({
      model,
      messages,
      temperature: opts?.temperature ?? 0.3,
      max_tokens: opts?.maxTokens,
    });
    return res.choices[0]?.message?.content?.trim() ?? "";
  }

  if (provider === "gemini") {
    const apiKey = process.env.GEMINI_API_KEY!;
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = process.env.WATCHER_MODEL ?? process.env.GEMINI_MODEL ?? "gemini-1.5-flash";
    const gemModel = genAI.getGenerativeModel({ model, ...(system ? { systemInstruction: system } : {}) });
    const res = await gemModel.generateContent(prompt);
    return res.response.text().trim();
  }

  throw new Error(`Unknown provider: ${provider}`);
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

  const provider = process.env.WATCHER_PROVIDER ?? detectProvider();
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
