import { describe, expect, it } from "vitest";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { buildAiClient } from "../src/kernel/services/ai.js";
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
