import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const bootstrap = fileURLToPath(new URL("../publish-daily.mjs", import.meta.url));
const tempDirs: string[] = [];

function git(cwd: string, ...args: string[]) {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), "readwise-bootstrap-"));
  tempDirs.push(root);
  const remote = path.join(root, "remote.git");
  const worker = path.join(root, "worker");
  const editor = path.join(root, "editor");
  const bin = path.join(root, "bin");
  const commandLog = path.join(root, "pnpm.log");

  git(root, "init", "--bare", remote);
  git(root, "init", "--initial-branch=main", worker);
  git(worker, "config", "user.name", "Test");
  git(worker, "config", "user.email", "test@example.com");
  writeFileSync(path.join(worker, "version.txt"), "old\n");
  git(worker, "add", "version.txt");
  git(worker, "commit", "-m", "initial");
  git(worker, "remote", "add", "origin", remote);
  git(worker, "push", "-u", "origin", "main");
  git(root, "clone", "--branch", "main", remote, editor);
  git(editor, "config", "user.name", "Test");
  git(editor, "config", "user.email", "test@example.com");

  mkdirSync(bin);
  const fakePnpm = path.join(bin, "pnpm");
  writeFileSync(fakePnpm, '#!/bin/sh\nprintf "%s\\n" "$*" >> "$DAILY_TEST_LOG"\nif [ "$1" = "install" ] && [ "$CI" != "1" ]; then exit 19; fi\nif [ "$DAILY_TEST_FAIL" = "$*" ]; then exit 17; fi\n');
  chmodSync(fakePnpm, 0o755);

  function run(fail = "") {
    return spawnSync(process.execPath, [bootstrap], {
      cwd: worker,
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH ?? ""}`,
        DAILY_TEST_LOG: commandLog,
        DAILY_TEST_FAIL: fail,
        CI: "",
      },
    });
  }

  function commands() {
    try {
      return readFileSync(commandLog, "utf8").trim().split("\n");
    } catch {
      return [];
    }
  }

  return { worker, editor, run, commands };
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("daily publish bootstrap", () => {
  it("updates to the newest main commit before validating and publishing", () => {
    const { worker, editor, run, commands } = fixture();
    writeFileSync(path.join(editor, "version.txt"), "new\n");
    git(editor, "commit", "-am", "new code");
    git(editor, "push", "origin", "main");

    const result = run();

    expect(result.status).toBe(0);
    expect(readFileSync(path.join(worker, "version.txt"), "utf8")).toBe("new\n");
    expect(commands()).toEqual([
      "install --frozen-lockfile",
      "run typecheck",
      "run test",
      "run publish:daily:core",
    ]);
  }, 20_000);

  it("stops before publishing when validation fails", () => {
    const { run, commands } = fixture();

    const result = run("run typecheck");

    expect(result.status).not.toBe(0);
    expect(commands()).toEqual(["install --frozen-lockfile", "run typecheck"]);
  }, 20_000);

  it("keeps a locally diverged checkout intact and does not publish", () => {
    const { worker, editor, run, commands } = fixture();
    writeFileSync(path.join(worker, "local.txt"), "local report\n");
    git(worker, "add", "local.txt");
    git(worker, "commit", "-m", "local report");
    writeFileSync(path.join(editor, "version.txt"), "new\n");
    git(editor, "commit", "-am", "new code");
    git(editor, "push", "origin", "main");
    const before = git(worker, "rev-parse", "HEAD");

    const result = run();

    expect(result.status).not.toBe(0);
    expect(git(worker, "rev-parse", "HEAD")).toBe(before);
    expect(commands()).toEqual([]);
  }, 20_000);
});
