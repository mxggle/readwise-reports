import { spawnSync } from "node:child_process";

function run(command, args, step, env = process.env) {
  console.log(`[publish] ${step}: ${command} ${args.join(" ")}`);
  const result = spawnSync(command, args, { encoding: "utf8", stdio: "inherit", env });
  if (result.error) throw new Error(`${step}: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`${step}: ${command} exited with status ${result.status ?? result.signal}`);
}

function read(command, args, step) {
  const result = spawnSync(command, args, { encoding: "utf8" });
  if (result.error) throw new Error(`${step}: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`${step}: ${result.stderr.trim() || `${command} exited with status ${result.status}`}`);
  return result.stdout.trim();
}

try {
  const branch = read("git", ["symbolic-ref", "--quiet", "--short", "HEAD"], "check branch");
  if (branch !== "main") throw new Error(`expected main branch, found ${branch}`);

  const changes = read("git", ["status", "--porcelain", "--untracked-files=no"], "check working tree");
  if (changes) throw new Error("tracked files have local changes; update stopped to preserve them");

  run("git", ["fetch", "origin", "main"], "fetch latest code");
  run("git", ["merge", "--ff-only", "FETCH_HEAD"], "update main without rewriting commits");
  run("pnpm", ["install", "--frozen-lockfile"], "install locked dependencies", { ...process.env, CI: "1" });
  run("pnpm", ["run", "typecheck"], "typecheck");
  run("pnpm", ["run", "test"], "test");
  run("pnpm", ["run", "publish:daily:core"], "publish reports");
} catch (error) {
  console.error(`[publish] stopped: ${error instanceof Error ? error.message : error}`);
  process.exitCode = 1;
}
