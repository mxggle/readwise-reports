import { Command } from "commander";
import { env } from "./kernel/env.js";
import { formatDate } from "./kernel/date.js";
import { findSkill, loadRegistry } from "./kernel/registry.js";
import { invokeSkill } from "./kernel/runtime.js";

const program = new Command();
program
  .option("--skill <id>", "Run a single skill by id")
  .option("--all", "Run all enabled skills (default when --skill not given)")
  .option("--date <date>", "Report date YYYY-MM-DD")
  .option("--dry-run", "Do not commit dedup state")
  .option("--list", "List discovered skills and exit");
program.parse();
const opts = program.opts<{
  skill?: string;
  all?: boolean;
  date?: string;
  dryRun?: boolean;
  list?: boolean;
}>();

const registry = await loadRegistry();

if (opts.list) {
  if (registry.length === 0) {
    console.log("No skills discovered.");
  } else {
    console.log(`Discovered ${registry.length} skill(s):`);
    for (const entry of registry) {
      const enabled = entry.manifest.enabled !== false;
      const required = entry.manifest.env?.required ?? [];
      const missing = required.filter((v) => !process.env[v]);
      const status = !enabled ? "disabled" : missing.length ? `missing env: ${missing.join(", ")}` : "ready";
      console.log(`  - ${entry.manifest.id.padEnd(12)} ${entry.manifest.title.padEnd(20)} [${status}]`);
    }
  }
  process.exit(0);
}

const date = opts.date || formatDate(new Date(), env.timezone);
const dryRun = !!opts.dryRun;

const enabled = registry.filter((e) => e.manifest.enabled !== false);
let toRun: typeof registry;
if (opts.skill) {
  const entry = findSkill(registry, opts.skill);
  if (!entry) {
    console.error(`Skill not found: ${opts.skill}`);
    console.error(`Available: ${registry.map((e) => e.manifest.id).join(", ") || "(none)"}`);
    process.exit(1);
  }
  toRun = [entry];
} else {
  toRun = enabled;
}

if (toRun.length === 0) {
  console.log("No enabled skills to run.");
  process.exit(0);
}

console.log(`Running ${toRun.length} skill(s) for ${date}${dryRun ? " (dry-run)" : ""}`);

let failed = 0;
for (const entry of toRun) {
  console.log(`\n=== ${entry.manifest.id} ===`);
  try {
    const result = await invokeSkill(entry, { date, dryRun });
    console.log(`  -> ${result.itemsProcessed} processed, ${result.itemsSkipped} skipped` + (result.outputPath ? `, output: ${result.outputPath}` : ""));
  } catch (err) {
    failed++;
    console.error(`  FAILED ${entry.manifest.id}:`, err instanceof Error ? err.message : err);
  }
}

if (failed > 0) process.exit(1);
