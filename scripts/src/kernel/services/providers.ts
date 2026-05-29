import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenerativeAI } from "@google/generative-ai";
import type { AICompleteOptions } from "../types.js";

// Single home for every provider's completion call. Both the in-process api
// client (services/ai.ts) and the out-of-process watcher (agent-watcher.ts)
// route through callProvider, so provider quirks (base URL, default model,
// message shape) live in exactly one place instead of being copied twice.

export type ProviderId = "openai" | "gemini" | "deepseek" | "anthropic";

/** Env var holding each provider's API key. */
export const PROVIDER_ENV: Record<ProviderId, string> = {
  openai: "OPENAI_API_KEY",
  gemini: "GEMINI_API_KEY",
  deepseek: "DEEPSEEK_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
};

/** Optional model-override env var and built-in default model per provider. */
const PROVIDER_MODEL: Record<ProviderId, { env: string; fallback: string }> = {
  openai: { env: "OPENAI_MODEL", fallback: "gpt-4o-mini" },
  gemini: { env: "GEMINI_MODEL", fallback: "gemini-1.5-flash" },
  deepseek: { env: "DEEPSEEK_MODEL", fallback: "deepseek-chat" },
  anthropic: { env: "ANTHROPIC_MODEL", fallback: "claude-sonnet-4-6" },
};

export function isProviderId(v: string | undefined): v is ProviderId {
  return v === "openai" || v === "gemini" || v === "deepseek" || v === "anthropic";
}

/** Resolve a model: explicit override → provider's *_MODEL env → built-in default. */
export function resolveModel(provider: ProviderId, override?: string): string {
  return override || process.env[PROVIDER_MODEL[provider].env] || PROVIDER_MODEL[provider].fallback;
}

/**
 * Call one provider's completion API. The key is read from the provider's env
 * var and must be present (throws otherwise). `model` overrides the resolved
 * default; everything else comes from `opts`.
 */
export async function callProvider(
  provider: ProviderId,
  prompt: string,
  opts?: AICompleteOptions,
  model?: string,
): Promise<string> {
  const apiKey = process.env[PROVIDER_ENV[provider]];
  if (!apiKey) throw new Error(`${PROVIDER_ENV[provider]} missing`);
  const resolved = resolveModel(provider, model);

  switch (provider) {
    case "openai":
      return openAiCompatible(new OpenAI({ apiKey }), resolved, prompt, opts);
    case "deepseek":
      return openAiCompatible(new OpenAI({ apiKey, baseURL: "https://api.deepseek.com" }), resolved, prompt, opts);
    case "anthropic":
      return anthropicComplete(apiKey, resolved, prompt, opts);
    case "gemini":
      return geminiComplete(apiKey, resolved, prompt, opts);
    default:
      throw new Error(`Unknown provider: ${provider}`);
  }
}

/** OpenAI and DeepSeek share the OpenAI chat-completions shape. */
async function openAiCompatible(client: OpenAI, model: string, prompt: string, opts?: AICompleteOptions): Promise<string> {
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

async function anthropicComplete(apiKey: string, model: string, prompt: string, opts?: AICompleteOptions): Promise<string> {
  const client = new Anthropic({ apiKey });
  const res = await client.messages.create({
    model,
    max_tokens: opts?.maxTokens ?? 4096,
    ...(opts?.temperature !== undefined ? { temperature: opts.temperature } : {}),
    ...(opts?.system ? { system: opts.system } : {}),
    messages: [{ role: "user", content: prompt }],
  });
  const block = res.content[0];
  return block && block.type === "text" ? block.text.trim() : "";
}

async function geminiComplete(apiKey: string, model: string, prompt: string, opts?: AICompleteOptions): Promise<string> {
  const genAI = new GoogleGenerativeAI(apiKey);
  const gemModel = genAI.getGenerativeModel({
    model,
    ...(opts?.system ? { systemInstruction: opts.system } : {}),
  });
  const res = await gemModel.generateContent(prompt);
  return res.response.text().trim();
}
