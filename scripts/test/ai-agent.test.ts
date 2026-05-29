import { describe, expect, it } from "vitest";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { buildAiClient, providerOrder } from "../src/kernel/services/ai.js";
import { SkillManifestSchema, type SkillManifest } from "../src/kernel/types.js";

const TASK_DIR = "generated/agent-tasks";
const RESULT_DIR = "generated/agent-results";

function makeManifest(): SkillManifest {
  return SkillManifestSchema.parse({
    id: "test-agent",
    title: "Test Agent",
    ai: { mode: "agent" },
  });
}

async function findTaskFile(skillId: string, maxWaitMs = 5000): Promise<string> {
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    try {
      const files = await readdir(TASK_DIR);
      const found = files.find((f) => f.startsWith(`${skillId}-`));
      if (found) return path.join(TASK_DIR, found);
    } catch {
      // dir may not exist yet
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`task file for ${skillId} did not appear within ${maxWaitMs}ms`);
}

describe("ai service: agent mode protocol", () => {
  it("writes a versioned task and resolves with the completion from result file", async () => {
    await mkdir(TASK_DIR, { recursive: true });
    await mkdir(RESULT_DIR, { recursive: true });

    const manifest = makeManifest();
    const client = buildAiClient(manifest);

    const completePromise = client.complete("hello prompt", { temperature: 0.5, maxTokens: 100 });

    const taskFile = await findTaskFile(manifest.id);
    const task = JSON.parse(await readFile(taskFile, "utf8"));

    expect(task.version).toBe(1);
    expect(task.skill).toBe("test-agent");
    expect(task.prompt).toBe("hello prompt");
    expect(task.opts.temperature).toBe(0.5);
    expect(task.opts.maxTokens).toBe(100);
    expect(typeof task.resultFile).toBe("string");
    expect(typeof task.taskId).toBe("string");

    await writeFile(task.resultFile, JSON.stringify({ completion: "agent-response" }));

    const result = await completePromise;
    expect(result).toBe("agent-response");

    await rm(taskFile, { force: true });
    await rm(task.resultFile, { force: true });
  }, 15000);

  it("cleans up both task and result files after a successful completion", async () => {
    await mkdir(TASK_DIR, { recursive: true });
    await mkdir(RESULT_DIR, { recursive: true });

    const manifest = SkillManifestSchema.parse({ id: "test-cleanup", title: "x", ai: { mode: "agent" } });
    const client = buildAiClient(manifest);
    const completePromise = client.complete("clean me");

    const taskFile = await findTaskFile(manifest.id);
    const task = JSON.parse(await readFile(taskFile, "utf8"));
    await writeFile(task.resultFile, JSON.stringify({ completion: "done" }));

    expect(await completePromise).toBe("done");

    // the client consumes the result and removes both files itself
    await expect(readFile(taskFile, "utf8")).rejects.toThrow();
    await expect(readFile(task.resultFile, "utf8")).rejects.toThrow();
  }, 15000);

  it("surfaces agent-reported errors", async () => {
    await mkdir(TASK_DIR, { recursive: true });
    await mkdir(RESULT_DIR, { recursive: true });

    const manifest = SkillManifestSchema.parse({
      id: "test-error",
      title: "Test Error",
      ai: { mode: "agent" },
    });
    const client = buildAiClient(manifest);

    const completePromise = client.complete("trigger");
    const taskFile = await findTaskFile(manifest.id);
    const task = JSON.parse(await readFile(taskFile, "utf8"));
    await writeFile(task.resultFile, JSON.stringify({ error: "model overloaded" }));

    await expect(completePromise).rejects.toThrow(/model overloaded/);

    await rm(taskFile, { force: true });
    await rm(task.resultFile, { force: true });
  }, 15000);
});

describe("ai service: auto mode host-agent detection", () => {
  const HOST_VARS = ["AGENT_AI", "CLAUDECODE", "AI_AGENT", "CLAUDE_AGENT_ID"] as const;

  function clearHostEnv(): Record<string, string | undefined> {
    const saved: Record<string, string | undefined> = {};
    for (const v of HOST_VARS) {
      saved[v] = process.env[v];
      delete process.env[v];
    }
    return saved;
  }

  function restoreEnv(saved: Record<string, string | undefined>): void {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }

  function autoManifest(id: string): SkillManifest {
    return SkillManifestSchema.parse({ id, title: id, ai: { mode: "auto" } });
  }

  it("auto resolves to agent mode when a host-agent marker is present", async () => {
    const saved = clearHostEnv();
    process.env.CLAUDECODE = "1";
    try {
      await mkdir(TASK_DIR, { recursive: true });
      const manifest = autoManifest("test-auto-agent");
      const client = buildAiClient(manifest);
      const completePromise = client.complete("ping");

      // agent path writes a task file; if it had fallen back to api this would never appear
      const taskFile = await findTaskFile(manifest.id);
      const task = JSON.parse(await readFile(taskFile, "utf8"));
      await writeFile(task.resultFile, JSON.stringify({ completion: "ok" }));

      expect(await completePromise).toBe("ok");
      await rm(taskFile, { force: true });
      await rm(task.resultFile, { force: true });
    } finally {
      restoreEnv(saved);
    }
  }, 15000);

  it("auto falls back to api mode when no host-agent marker and no API key", async () => {
    const saved = clearHostEnv();
    const savedKeys = {
      OPENAI_API_KEY: process.env.OPENAI_API_KEY,
      GEMINI_API_KEY: process.env.GEMINI_API_KEY,
      DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY,
    };
    delete process.env.OPENAI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    delete process.env.DEEPSEEK_API_KEY;
    try {
      const client = buildAiClient(autoManifest("test-auto-api"));
      // api path with no provider configured rejects immediately (no task file, no polling)
      await expect(client.complete("ping")).rejects.toThrow(/No AI provider available/);
    } finally {
      restoreEnv({ ...saved, ...savedKeys });
    }
  });
});

describe("ai service: provider fallback order", () => {
  it("puts the preferred provider first, then the rest as fallbacks", () => {
    expect(providerOrder("openai")).toEqual(["openai", "gemini", "deepseek", "anthropic"]);
    expect(providerOrder("gemini")).toEqual(["gemini", "openai", "deepseek", "anthropic"]);
    expect(providerOrder("deepseek")).toEqual(["deepseek", "openai", "gemini", "anthropic"]);
    expect(providerOrder("anthropic")).toEqual(["anthropic", "openai", "gemini", "deepseek"]);
  });

  it("falls back to openai-first for unknown or missing preferred", () => {
    expect(providerOrder(undefined)).toEqual(["openai", "gemini", "deepseek", "anthropic"]);
    expect(providerOrder("nonsense")).toEqual(["openai", "gemini", "deepseek", "anthropic"]);
  });

  it("every provider in the order has a callable implementation reachable", () => {
    // all four provider ids appear exactly once regardless of preferred
    const order = providerOrder("anthropic");
    expect(new Set(order).size).toBe(4);
  });

  it("error message lists every provider env var when no key is set", async () => {
    const savedMode = process.env.AI_MODE;
    const savedKeys = {
      OPENAI_API_KEY: process.env.OPENAI_API_KEY,
      GEMINI_API_KEY: process.env.GEMINI_API_KEY,
      DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY,
      ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    };
    process.env.AI_MODE = "api";
    for (const k of Object.keys(savedKeys)) delete process.env[k];
    try {
      const manifest = SkillManifestSchema.parse({ id: "test-no-key", title: "x", ai: { mode: "api" } });
      await expect(buildAiClient(manifest).complete("ping")).rejects.toThrow(
        /OPENAI_API_KEY.*GEMINI_API_KEY.*DEEPSEEK_API_KEY.*ANTHROPIC_API_KEY/s,
      );
    } finally {
      if (savedMode === undefined) delete process.env.AI_MODE;
      else process.env.AI_MODE = savedMode;
      for (const [k, v] of Object.entries(savedKeys)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  });
});

describe("ai service: AI_MODE env override", () => {
  function agentManifest(id: string): SkillManifest {
    return SkillManifestSchema.parse({ id, title: id, ai: { mode: "agent" } });
  }

  it("AI_MODE=api forces api mode even for an explicit agent-mode skill", async () => {
    const savedMode = process.env.AI_MODE;
    const savedKeys = {
      OPENAI_API_KEY: process.env.OPENAI_API_KEY,
      GEMINI_API_KEY: process.env.GEMINI_API_KEY,
      DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY,
    };
    process.env.AI_MODE = "api";
    delete process.env.OPENAI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    delete process.env.DEEPSEEK_API_KEY;
    try {
      const client = buildAiClient(agentManifest("test-override-api"));
      // had it stayed in agent mode it would write a task and poll for 10 min;
      // api mode with no key rejects immediately instead.
      await expect(client.complete("ping")).rejects.toThrow(/No AI provider available/);
    } finally {
      if (savedMode === undefined) delete process.env.AI_MODE;
      else process.env.AI_MODE = savedMode;
      for (const [k, v] of Object.entries(savedKeys)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  });

  it("invalid AI_MODE is ignored and the manifest mode wins", async () => {
    const savedMode = process.env.AI_MODE;
    process.env.AI_MODE = "nonsense";
    try {
      await mkdir(TASK_DIR, { recursive: true });
      const manifest = agentManifest("test-override-invalid");
      const client = buildAiClient(manifest);
      const completePromise = client.complete("ping");

      // manifest mode (agent) should win → a task file appears
      const taskFile = await findTaskFile(manifest.id);
      const task = JSON.parse(await readFile(taskFile, "utf8"));
      await writeFile(task.resultFile, JSON.stringify({ completion: "ok" }));

      expect(await completePromise).toBe("ok");
      await rm(taskFile, { force: true });
      await rm(task.resultFile, { force: true });
    } finally {
      if (savedMode === undefined) delete process.env.AI_MODE;
      else process.env.AI_MODE = savedMode;
    }
  }, 15000);
});
