import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import matter from "gray-matter";

const root = process.cwd();
const dailyDir = path.join(root, "docs", "daily");

async function dailyLinks() {
  const files = (await readdir(dailyDir)).filter((f) => /^\d{4}-\d{2}-\d{2}\.md$/.test(f)).sort().reverse();
  return files.map((f) => `- [${f.replace(".md", "")}](${f})`).join("\n");
}

async function updateBetween(file: string, start: string, end: string, content: string) {
  const p = path.join(root, file);
  const old = await readFile(p, "utf8");
  const next = old.replace(new RegExp(`${start}[\\s\\S]*?${end}`), `${start}\n${content}\n${end}`);
  await writeFile(p, next);
}

const links = await dailyLinks();
await updateBetween("docs/index.md", "<!-- DAILY_REPORTS_START -->", "<!-- DAILY_REPORTS_END -->", links.replace(/\]\(([^)]+)\)/g, "](daily/$1)"));
await updateBetween("docs/daily/index.md", "<!-- DAILY_REPORTS_START -->", "<!-- DAILY_REPORTS_END -->", links);
console.log("Indexes updated");
