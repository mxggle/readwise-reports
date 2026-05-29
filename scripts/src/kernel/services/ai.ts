import { mkdir, readFile, readdir, rename, stat, unlink, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import type { AIClient, AIMode, SkillManifest } from "../types.js";
import { callProvider, isProviderId, PROVIDER_ENV, type ProviderId } from "./providers.js";

const TASK_DIR = "generated/agent-tasks";
const RESULT_DIR = "generated/agent-results";
const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 10 * 60 * 1000;
const STALE_AGE_MS = 24 * 60 * 60 * 1000;
const PROTOCOL_VERSION = 1;
let sweptOnce = false;

export function buildAiClient(manifest: SkillManifest): AIClient {
  const mode = resolveAiMode(manifest);
  return mode === "agent" ? agentClient(manifest) : apiClient(manifest);
}

/**
 * Resolve a manifest's effective AI mode, applying `auto` host-agent detection.
 *
 * A valid `AI_MODE` env var (api | agent | auto) overrides the manifest mode for
 * every skill. This is the operator escape hatch for automated runs (cron): set
 * `AI_MODE=api` so jobs never resolve to agent mode and block waiting on a watcher,
 * even if launched from inside a host agent that exports CLAUDECODE/AGENT_AI.
 */
export function resolveAiMode(manifest: SkillManifest): "api" | "agent" {
  const override = parseModeEnv(process.env.AI_MODE);
  return resolveMode(override ?? manifest.ai?.mode ?? "auto");
}

function parseModeEnv(value: string | undefined): AIMode | undefined {
  return value === "api" || value === "agent" || value === "auto" ? value : undefined;
}

function resolveMode(mode: AIMode): "api" | "agent" {
  if (mode === "auto") {
    return hostAgentPresent() ? "agent" : "api";
  }
  return mode;
}

/**
 * True when we are running inside a host agent (Claude Code, Hermes, etc.) that
 * can act as the agent-mode task watcher. In that case the host agent fulfils
 * AI completions with its own model — no API key required.
 *
 * Detection is intentionally broad: each host exposes a different marker.
 *   - Claude Code sets CLAUDECODE=1 and AI_AGENT=claude-code_*.
 *   - Other harnesses can opt in explicitly with AGENT_AI=1.
 *   - CLAUDE_AGENT_ID kept for backwards compatibility.
 */
function hostAgentPresent(): boolean {
  return Boolean(
    process.env.AGENT_AI === "1" ||
      process.env.CLAUDECODE === "1" ||
      process.env.AI_AGENT ||
      process.env.CLAUDE_AGENT_ID,
  );
}

/** Fallback order used after the preferred provider. */
const DEFAULT_ORDER: ProviderId[] = ["openai", "gemini", "deepseek", "anthropic"];

function apiClient(manifest: SkillManifest): AIClient {
  return {
    complete: async (prompt, opts) => {
      const order = providerOrder(manifest.ai?.provider);
      const preferred = order[0];

      let lastErr: unknown;
      let attempted = false;
      for (const provider of order) {
        if (!process.env[PROVIDER_ENV[provider]]) continue; // no key → skip, try next
        attempted = true;
        try {
          // The configured model only applies to the preferred provider; fallbacks
          // use their own default model (a gpt model id is meaningless to Gemini, etc.).
          const model = provider === preferred ? manifest.ai?.model : undefined;
          return await callProvider(provider, prompt, opts, model);
        } catch (err) {
          lastErr = err; // best-effort: try the next provider that has a key
        }
      }
      if (attempted && lastErr) throw lastErr;
      throw new Error(
        `No AI provider available. Set one of: ${Object.values(PROVIDER_ENV).join(", ")}.`,
      );
    },
  };
}

/** Preferred provider first, then the remaining providers as fallbacks. */
export function providerOrder(preferred: string | undefined): ProviderId[] {
  const head: ProviderId = isProviderId(preferred) ? preferred : "openai";
  return [head, ...DEFAULT_ORDER.filter((p) => p !== head)];
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

        let text: string;
        try {
          text = await readFile(resultFile, "utf8");
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code === "ENOENT") continue; // not produced yet
          throw err;
        }

        let data: { completion?: string; error?: string };
        try {
          data = JSON.parse(text) as { completion?: string; error?: string };
        } catch {
          continue; // mid-write (atomic rename means this is rare); retry next tick
        }

        // We are the sole consumer of the result file — clean up both files now
        // so they never linger or get committed. The task file is usually already
        // gone (the watcher deletes it), so unlink is best-effort.
        await unlink(resultFile).catch(() => undefined);
        await unlink(taskFile).catch(() => undefined);

        if (data.error) throw new Error(`Agent reported error: ${data.error}`);
        if (typeof data.completion === "string") return data.completion;
        throw new Error(`Agent returned a result with neither completion nor error for task ${taskId}.`);
      }

      // Timed out: no watcher produced a result. Remove the orphaned task file so
      // it is not picked up later and never risks being committed.
      await unlink(taskFile).catch(() => undefined);
      throw new Error(
        `Agent mode timeout: skill "${manifest.id}" task ${taskId} produced no result in ${Math.round(POLL_TIMEOUT_MS / 1000)}s. ` +
        `No watcher was draining ${TASK_DIR}. Start one (pnpm watcher) or resolve via pnpm agent:tasks.`,
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
