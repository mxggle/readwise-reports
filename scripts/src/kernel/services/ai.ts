import OpenAI from "openai";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { mkdir, readFile, readdir, rename, stat, unlink, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import type { AIClient, AICompleteOptions, AIMode, SkillManifest } from "../types.js";

const TASK_DIR = "generated/agent-tasks";
const RESULT_DIR = "generated/agent-results";
const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 10 * 60 * 1000;
const STALE_AGE_MS = 24 * 60 * 60 * 1000;
const PROTOCOL_VERSION = 1;
let sweptOnce = false;

export function buildAiClient(manifest: SkillManifest): AIClient {
  const mode = resolveMode(manifest.ai?.mode ?? "auto");
  return mode === "agent" ? agentClient(manifest) : apiClient(manifest);
}

function resolveMode(mode: AIMode): "api" | "agent" {
  if (mode === "auto") {
    return process.env.CLAUDE_AGENT_ID ? "agent" : "api";
  }
  return mode;
}

function apiClient(manifest: SkillManifest): AIClient {
  return {
    complete: async (prompt, opts) => {
      const preferred = manifest.ai?.provider ?? "openai";
      const order = providerOrder(preferred);

      let lastErr: unknown;
      for (const provider of order) {
        try {
          if (provider === "openai" && process.env.OPENAI_API_KEY) {
            return await callOpenAI(prompt, opts, manifest.ai?.model);
          }
          if (provider === "gemini" && process.env.GEMINI_API_KEY) {
            return await callGemini(prompt, opts, manifest.ai?.model);
          }
        } catch (err) {
          lastErr = err;
        }
      }
      if (lastErr) throw lastErr;
      throw new Error("No AI provider available (set OPENAI_API_KEY or GEMINI_API_KEY)");
    },
  };
}

function providerOrder(preferred: string): Array<"openai" | "gemini"> {
  if (preferred === "gemini") return ["gemini", "openai"];
  return ["openai", "gemini"];
}

async function callOpenAI(prompt: string, opts: AICompleteOptions | undefined, modelOverride?: string): Promise<string> {
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const model = modelOverride || process.env.OPENAI_MODEL || "gpt-4o-mini";
  const messages: { role: "system" | "user"; content: string }[] = [];
  if (opts?.system) messages.push({ role: "system", content: opts.system });
  messages.push({ role: "user", content: prompt });
  const res = await client.chat.completions.create({
    model,
    messages,
    temperature: opts?.temperature ?? 0.3,
    max_tokens: opts?.maxTokens,
  });
  return res.choices[0]?.message?.content?.trim() ?? "";
}

async function callGemini(prompt: string, opts: AICompleteOptions | undefined, modelOverride?: string): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY missing");
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = modelOverride || process.env.GEMINI_MODEL || "gemini-1.5-flash";
  const gemModel = genAI.getGenerativeModel({
    model,
    ...(opts?.system ? { systemInstruction: opts.system } : {}),
  });
  const res = await gemModel.generateContent(prompt);
  return res.response.text().trim();
}

function agentClient(manifest: SkillManifest): AIClient {
  return {
    complete: async (prompt, opts) => {
      await mkdir(TASK_DIR, { recursive: true });
      await mkdir(RESULT_DIR, { recursive: true });
      if (!sweptOnce) {
        sweptOnce = true;
        await sweepStaleAgentFiles().catch(() => undefined);
      }

      const taskId = randomUUID();
      const taskFile = path.join(TASK_DIR, `${manifest.id}-${taskId}.json`);
      const resultFile = path.join(RESULT_DIR, `${manifest.id}-${taskId}.json`);
      const task = {
        version: PROTOCOL_VERSION,
        taskId,
        skill: manifest.id,
        createdAt: new Date().toISOString(),
        prompt,
        system: opts?.system,
        opts: {
          maxTokens: opts?.maxTokens,
          temperature: opts?.temperature,
        },
        resultFile,
      };
      await atomicWriteJson(taskFile, task);

      const start = Date.now();
      while (Date.now() - start < POLL_TIMEOUT_MS) {
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
        try {
          const text = await readFile(resultFile, "utf8");
          let data: { completion?: string; error?: string };
          try {
            data = JSON.parse(text) as { completion?: string; error?: string };
          } catch {
            continue;
          }
          if (data.error) throw new Error(`Agent reported error: ${data.error}`);
          if (typeof data.completion === "string") return data.completion;
        } catch (err) {
          if (err instanceof Error && (err as NodeJS.ErrnoException).code === "ENOENT") continue;
          throw err;
        }
      }
      throw new Error(
        `Agent mode timeout: skill "${manifest.id}" task ${taskId} produced no result in ${Math.round(POLL_TIMEOUT_MS / 1000)}s.\n` +
        `  Task file: ${taskFile}\n` +
        `  Expected result at: ${resultFile} (write { completion: "..." } or { error: "..." } atomically).`,
      );
    },
  };
}

async function atomicWriteJson(targetPath: string, data: unknown): Promise<void> {
  const tmpPath = `${targetPath}.tmp-${randomUUID()}`;
  await writeFile(tmpPath, JSON.stringify(data, null, 2));
  await rename(tmpPath, targetPath);
}

async function sweepStaleAgentFiles(): Promise<void> {
  const cutoff = Date.now() - STALE_AGE_MS;
  for (const dir of [TASK_DIR, RESULT_DIR]) {
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch (err) {
      if (err instanceof Error && (err as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw err;
    }
    for (const name of entries) {
      const full = path.join(dir, name);
      try {
        const s = await stat(full);
        if (s.mtimeMs < cutoff) await unlink(full);
      } catch {
        // best-effort cleanup
      }
    }
  }
}
