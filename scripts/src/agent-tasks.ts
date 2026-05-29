/**
 * agent-tasks — host-agent watcher helper.
 *
 * In "agent" AI mode, skills write task files to generated/agent-tasks/ and poll
 * generated/agent-results/ for a completion. This helper lets the *host agent*
 * (Claude Code, Hermes, ...) act as the watcher: it lists pending tasks and
 * writes results back, fulfilling completions with the host's own model — no
 * API key required.
 *
 * This is the agent-driven alternative to agent-watcher.ts (which calls an
 * external provider with its own API key). Do NOT run both at once.
 *
 * Usage:
 *   tsx scripts/src/agent-tasks.ts list [--json]
 *   tsx scripts/src/agent-tasks.ts resolve <taskId> --text "completion"
 *   tsx scripts/src/agent-tasks.ts resolve <taskId> --file path/to/completion.txt
 *   tsx scripts/src/agent-tasks.ts resolve <taskId> --error "what went wrong"
 */
import { mkdir, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";

const TASK_DIR = "generated/agent-tasks";
const RESULT_DIR = "generated/agent-results";

interface AgentTask {
  version: number;
  taskId: string;
  skill: string;
  createdAt?: string;
  prompt: string;
  system?: string;
  opts?: { maxTokens?: number; temperature?: number };
  resultFile: string;
}

async function readPendingTasks(): Promise<Array<{ file: string; task: AgentTask }>> {
  let names: string[];
  try {
    names = await readdir(TASK_DIR);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
  const out: Array<{ file: string; task: AgentTask }> = [];
  for (const name of names) {
    if (!name.endsWith(".json") || name.includes(".tmp-")) continue;
    const file = path.join(TASK_DIR, name);
    try {
      const task = JSON.parse(await readFile(file, "utf8")) as AgentTask;
      out.push({ file, task });
    } catch {
      // partial / mid-write file — skip this pass
    }
  }
  out.sort((a, b) => (a.task.createdAt ?? "").localeCompare(b.task.createdAt ?? ""));
  return out;
}

async function atomicWriteJson(targetPath: string, data: unknown): Promise<void> {
  await mkdir(path.dirname(targetPath), { recursive: true });
  const tmp = `${targetPath}.tmp-${randomUUID()}`;
  await writeFile(tmp, JSON.stringify(data, null, 2));
  await rename(tmp, targetPath);
}

function parseFlags(argv: string[]): { positional: string[]; flags: Record<string, string | boolean> } {
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    } else {
      positional.push(arg);
    }
  }
  return { positional, flags };
}

async function cmdList(json: boolean): Promise<void> {
  const pending = await readPendingTasks();
  if (json) {
    console.log(JSON.stringify(pending.map((p) => p.task), null, 2));
    return;
  }
  if (pending.length === 0) {
    console.log("No pending agent tasks.");
    return;
  }
  console.log(`${pending.length} pending agent task(s):\n`);
  for (const { task } of pending) {
    console.log(`• ${task.taskId}  [skill: ${task.skill}]  → ${task.resultFile}`);
    if (task.system) console.log(`  system: ${truncate(task.system, 200)}`);
    console.log(`  prompt: ${truncate(task.prompt, 400)}\n`);
  }
}

function truncate(s: string, n: number): string {
  const flat = s.replace(/\s+/g, " ").trim();
  return flat.length > n ? `${flat.slice(0, n)}…` : flat;
}

async function cmdResolve(taskId: string, flags: Record<string, string | boolean>): Promise<void> {
  const pending = await readPendingTasks();
  const exact = pending.find((p) => p.task.taskId === taskId);
  const prefixMatches = pending.filter((p) => p.task.taskId.startsWith(taskId));
  // Exact id always wins; otherwise the prefix must be unambiguous.
  const match = exact ?? (prefixMatches.length === 1 ? prefixMatches[0] : undefined);
  if (!match) {
    if (prefixMatches.length > 1) {
      console.error(`"${taskId}" is ambiguous — matches ${prefixMatches.length} tasks:`);
      for (const p of prefixMatches) console.error(`  ${p.task.taskId}  [skill: ${p.task.skill}]`);
      console.error("Use a longer prefix or the full taskId.");
    } else {
      console.error(`No pending task matches "${taskId}". Run \`list\` to see pending tasks.`);
    }
    process.exit(1);
  }
  const { file, task } = match;

  let payload: { completion?: string; error?: string };
  if (typeof flags.error === "string") {
    payload = { error: flags.error };
  } else if (typeof flags.file === "string") {
    payload = { completion: await readFile(flags.file, "utf8") };
  } else if (typeof flags.text === "string") {
    payload = { completion: flags.text };
  } else {
    console.error("Provide one of --text <completion>, --file <path>, or --error <message>.");
    process.exit(1);
  }

  await atomicWriteJson(task.resultFile, payload);
  await unlink(file).catch(() => undefined);
  console.log(`Resolved ${task.taskId} → ${task.resultFile}`);
}

async function main(): Promise<void> {
  const [, , cmd, ...rest] = process.argv;
  const { positional, flags } = parseFlags(rest);

  if (cmd === "list") {
    await cmdList(Boolean(flags.json));
    return;
  }
  if (cmd === "resolve") {
    const taskId = positional[0];
    if (!taskId) {
      console.error("Usage: agent-tasks resolve <taskId> --text|--file|--error ...");
      process.exit(1);
    }
    await cmdResolve(taskId, flags);
    return;
  }

  console.log(
    [
      "agent-tasks — let the host agent fulfil AI calls with its own model (no API key).",
      "",
      "Skills in agent mode write prompts to generated/agent-tasks/ and wait. You, the",
      "agent, answer them and write results to generated/agent-results/. Workflow:",
      "",
      "  1. pnpm agent:tasks list [--json]          list pending tasks (prompt + taskId)",
      "  2. read each task's prompt, produce the answer yourself",
      "  3. pnpm agent:tasks resolve <taskId> --text \"<answer>\"",
      "     pnpm agent:tasks resolve <taskId> --file <path-to-answer>",
      "     pnpm agent:tasks resolve <taskId> --error \"<why it failed>\"",
      "",
      "Repeat until the `pnpm generate` process exits. Tasks left unanswered time out",
      "after 10 minutes. Do not run `pnpm watcher` at the same time — it competes for",
      "the same tasks using an external API key.",
    ].join("\n"),
  );
  process.exit(cmd ? 1 : 0);
}

main().catch((err) => {
  console.error("[agent-tasks] fatal:", err);
  process.exit(1);
});
