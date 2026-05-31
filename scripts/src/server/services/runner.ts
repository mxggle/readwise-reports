import { spawn, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { cliEntry, repoRoot } from "../paths.js";
import { ApiError } from "../http.js";

const MAX_HISTORY = 2000;
const tsxBin = path.join(repoRoot, "node_modules", ".bin", "tsx");
const RUNS_DIR = path.join(repoRoot, "generated", "panel-runs");

/** Noise lines from the Node runtime that only confuse the user. */
const NOISE = /ExperimentalWarning|--trace-warnings|^\(node:\d+\)/;

export interface RunRecord {
  id: string;
  skillId: string;
  dryRun: boolean;
  startedAt: number;
  finishedAt: number;
  exitCode: number | null;
  log: string;
}

export interface RunInfo {
  id: string;
  skillId: string;
  status: "running" | "done";
  exitCode: number | null;
  startedAt: number;
}

/** A single skill run. Emits `log` (string lines) and `exit` (number|null). */
export class Run extends EventEmitter {
  readonly id = randomUUID();
  readonly startedAt = Date.now();
  status: "running" | "done" = "running";
  exitCode: number | null = null;
  readonly history: string[] = [];
  private buf = "";

  constructor(
    readonly skillId: string,
    readonly dryRun: boolean,
    private readonly child: ChildProcess,
  ) {
    super();
    child.stdout?.on("data", (d: Buffer) => this.ingest(d));
    child.stderr?.on("data", (d: Buffer) => this.ingest(d));
    child.on("error", (err) => {
      this.pushLine(`[panel] failed to start run: ${err.message}`);
      this.finish(null);
    });
    child.on("close", (code) => {
      if (this.buf) this.pushLine(this.buf);
      this.finish(code);
    });
  }

  private ingest(chunk: Buffer): void {
    this.buf += chunk.toString("utf8");
    const lines = this.buf.split("\n");
    this.buf = lines.pop() ?? "";
    for (const line of lines) this.pushLine(line);
  }

  private pushLine(line: string): void {
    if (NOISE.test(line)) return; // drop Node runtime noise
    this.history.push(line);
    if (this.history.length > MAX_HISTORY) this.history.shift();
    this.emit("log", line);
  }

  private finish(code: number | null): void {
    if (this.status === "done") return;
    this.status = "done";
    this.exitCode = code;
    this.emit("exit", code);
    void persistRun({
      id: this.id,
      skillId: this.skillId,
      dryRun: this.dryRun,
      startedAt: this.startedAt,
      finishedAt: Date.now(),
      exitCode: code,
      log: this.history.join("\n"),
    });
  }

  cancel(): void {
    if (this.status === "running") this.child.kill("SIGTERM");
  }

  info(): RunInfo {
    return { id: this.id, skillId: this.skillId, status: this.status, exitCode: this.exitCode, startedAt: this.startedAt };
  }
}

const runs = new Map<string, Run>();
const bySkill = new Map<string, string>(); // skillId -> active runId

export interface StartRunOptions {
  skillId: string;
  dryRun: boolean;
  date?: string;
}

export function startRun(opts: StartRunOptions): Run {
  if (bySkill.has(opts.skillId)) {
    throw new ApiError(409, `Skill "${opts.skillId}" is already running`);
  }

  const args = [cliEntry, "--skill", opts.skillId];
  if (opts.dryRun) args.push("--dry-run");
  if (opts.date) args.push("--date", opts.date);

  const child = spawn(tsxBin, args, {
    cwd: repoRoot,
    // AI_MODE=api so an agent-mode skill never blocks waiting for a watcher.
    env: { ...process.env, AI_MODE: process.env.AI_MODE ?? "api" },
  });

  const run = new Run(opts.skillId, opts.dryRun, child);
  runs.set(run.id, run);
  bySkill.set(opts.skillId, run.id);
  run.once("exit", () => {
    bySkill.delete(opts.skillId);
    // keep the finished Run around briefly so late SSE clients can replay it
    setTimeout(() => runs.delete(run.id), 60_000).unref();
  });
  return run;
}

export function getRun(id: string): Run | undefined {
  return runs.get(id);
}

export function cancelRun(id: string): boolean {
  const run = runs.get(id);
  if (!run) return false;
  run.cancel();
  return true;
}

export function isSkillRunning(skillId: string): boolean {
  return bySkill.has(skillId);
}

async function persistRun(record: RunRecord): Promise<void> {
  try {
    await mkdir(RUNS_DIR, { recursive: true });
    await appendFile(path.join(RUNS_DIR, `${record.skillId}.jsonl`), JSON.stringify(record) + "\n", "utf8");
  } catch {
    // history persistence is best-effort; a failure must not break a run
  }
}

/** Past run records for a skill, newest first (capped). */
export async function listRuns(skillId: string, limit = 20): Promise<Omit<RunRecord, "log">[]> {
  let text: string;
  try {
    text = await readFile(path.join(RUNS_DIR, `${skillId}.jsonl`), "utf8");
  } catch {
    return [];
  }
  const records = text
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as RunRecord)
    .map(({ log: _log, ...rest }) => rest);
  return records.reverse().slice(0, limit);
}

/** Full stored log for one past run (searches all skills' history files). */
export async function getRunRecord(skillId: string, runId: string): Promise<RunRecord | undefined> {
  let text: string;
  try {
    text = await readFile(path.join(RUNS_DIR, `${skillId}.jsonl`), "utf8");
  } catch {
    return undefined;
  }
  return text
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as RunRecord)
    .find((r) => r.id === runId);
}
