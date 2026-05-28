import { mkdir } from "node:fs/promises";
import path from "node:path";
import { execa } from "execa";
import { env } from "./kernel/env.js";
import { formatDate } from "./kernel/date.js";

const now = new Date();
const date = formatDate(now, env.timezone);
const hnDir = path.join("docs", "hn");
const outputPath = path.join(hnDir, `${date}.md`);
const scriptPath = path.join("skills", "hn", "lib", "digest.ts");

await mkdir(hnDir, { recursive: true });

console.log(`Generating HN digest for ${date} (last ${env.hnHours}h, top ${env.hnTopN})...`);

await execa(
  "npx",
  ["-y", "bun", scriptPath, "--hours", String(env.hnHours), "--top-n", String(env.hnTopN), "--output", outputPath],
  { stdio: "inherit" }
);

console.log(`Wrote ${outputPath}`);
await execa("pnpm", ["build:index"], { stdio: "inherit" });
