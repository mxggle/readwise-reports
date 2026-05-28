import OpenAI from "openai";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AIClient, AICompleteOptions, AIMode, SkillManifest } from "../types.js";

const TASK_DIR = "generated/agent-tasks";
const RESULT_DIR = "generated/agent-results";
const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 10 * 60 * 1000;

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
      const ts = Date.now();
      const taskFile = path.join(TASK_DIR, `${manifest.id}-${ts}.json`);
      const resultFile = path.join(RESULT_DIR, `${manifest.id}-${ts}.json`);
      const task = {
        skill: manifest.id,
        ts,
        prompt,
        system: opts?.system,
        resultFile,
      };
      await writeFile(taskFile, JSON.stringify(task, null, 2));

      const start = Date.now();
      while (Date.now() - start < POLL_TIMEOUT_MS) {
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
        try {
          const text = await readFile(resultFile, "utf8");
          const data = JSON.parse(text) as { completion?: string; error?: string };
          if (data.error) throw new Error(`Agent reported error: ${data.error}`);
          if (typeof data.completion === "string") return data.completion;
        } catch (err) {
          if (err instanceof Error && (err as NodeJS.ErrnoException).code === "ENOENT") continue;
          throw err;
        }
      }
      throw new Error(`Agent mode: result file ${resultFile} not produced within ${POLL_TIMEOUT_MS}ms`);
    },
  };
}
