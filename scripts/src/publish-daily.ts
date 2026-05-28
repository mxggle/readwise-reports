import dotenv from "dotenv";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { execa } from "execa";
import { formatDate } from "./kernel/date.js";
import { env } from "./kernel/env.js";
import type { ReportData } from "../../skills/readwise/lib/types.js";

dotenv.config();

const date = formatDate(new Date(), env.timezone);

async function run(cmd: string, args: string[]) {
  console.log(`$ ${cmd} ${args.join(" ")}`);
  return execa(cmd, args, { stdio: "inherit" });
}

await run("pnpm", ["generate", "--", "--skill", "readwise", "--date", date, "--dry-run"]);
await run("pnpm", ["build:index"]);

await run("git", ["add", "docs", "generated", "mkdocs.yml", "README.md"]);
const diff = await execa("git", ["diff", "--cached", "--quiet"], { reject: false });
if (diff.exitCode === 0) {
  console.log("No report changes to commit");
} else {
  await run("git", ["commit", "-m", `chore: generate Readwise report ${date}`]);
  await run("git", ["push", "origin", "main"]);
}

const rawPath = path.join("generated", "raw", `${date}.json`);
const data = JSON.parse(await readFile(rawPath, "utf8")) as ReportData;
const top = data.items.filter((i) => i.action === "READ").slice(0, 3);
const url = env.publicSiteUrl ? `${env.publicSiteUrl}/readwise/${date}/` : "";
const summary = [
  `${data.items.length} 条内容，${top.length} 条优先读。`,
  top[0] ? `Top 1：${top[0].title}` : "今天没有明显 S 级内容。",
  `关键词：${data.keywords.slice(0, 5).join(" / ") || "暂无"}`,
].join("\n");

await run("pnpm", ["notify", `Readwise Daily｜${date}`, summary, url]);
