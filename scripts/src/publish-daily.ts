import dotenv from "dotenv";
import { execa } from "execa";
import { env } from "./kernel/env.js";
import { formatDate } from "./kernel/date.js";
import { loadRegistry } from "./kernel/registry.js";
import { invokeSkill } from "./kernel/runtime.js";
import type { NotificationPayload } from "./kernel/types.js";

dotenv.config();

const date = formatDate(new Date(), env.timezone);

async function run(cmd: string, args: string[]) {
  console.log(`$ ${cmd} ${args.join(" ")}`);
  return execa(cmd, args, { stdio: "inherit" });
}

const registry = await loadRegistry();
const enabled = registry.filter((e) => e.manifest.enabled !== false);

const envIssues = enabled
  .map((e) => ({ id: e.manifest.id, missing: (e.manifest.env?.required ?? []).filter((v) => !process.env[v]) }))
  .filter((x) => x.missing.length > 0);
if (envIssues.length > 0) {
  for (const { id, missing } of envIssues) console.error(`[publish] ${id} missing env: ${missing.join(", ")}`);
  process.exit(1);
}

const notifications: NotificationPayload[] = [];
let failed = 0;
for (const entry of enabled) {
  console.log(`\n[publish] === ${entry.manifest.id} ===`);
  try {
    const result = await invokeSkill(entry, { date, dryRun: true });
    console.log(`[publish] ${entry.manifest.id}: ${result.itemsProcessed} processed, ${result.itemsSkipped} skipped`);
    if (result.notifications) notifications.push(...result.notifications);
  } catch (err) {
    failed++;
    console.error(`[publish] ${entry.manifest.id} FAILED:`, err instanceof Error ? err.message : err);
  }
}

if (failed === enabled.length) {
  console.error("[publish] all skills failed; aborting");
  process.exit(1);
}

await run("pnpm", ["build:index"]);

await run("git", ["add", "docs", "generated", "mkdocs.yml", "README.md"]);
const diff = await execa("git", ["diff", "--cached", "--quiet"], { reject: false });
if (diff.exitCode === 0) {
  console.log("[publish] No report changes to commit");
} else {
  await run("git", ["commit", "-m", `chore: generate reports ${date}`]);
  await run("git", ["push", "origin", "main"]);
}

for (const n of notifications) {
  if (n.channel !== "discord") {
    console.warn(`[publish] no dispatcher for channel "${n.channel}"; skipping`);
    continue;
  }
  await run("pnpm", ["notify", n.title, n.body, n.url ?? ""]);
}

if (failed > 0) process.exit(1);
