import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import matter from "gray-matter";

const root = process.cwd();
const readwiseDir = path.join(root, "docs", "readwise");
const hnDir = path.join(root, "docs", "hn");

const DATE_RE = /^\d{4}-\d{2}-\d{2}\.md$/;

type ReportEntry = {
  date: string;
  href: string;
  title?: string;
  summary?: string;
  stats?: string;
};

function truncate(text: string, max = 180): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  return clean.slice(0, max).replace(/[，,。.；;]\s*\S*$/, "") + "…";
}

async function listDates(dir: string): Promise<string[]> {
  try {
    const files = await readdir(dir);
    return files.filter((f) => DATE_RE.test(f)).sort().reverse();
  } catch {
    return [];
  }
}

async function readReadwise(file: string): Promise<ReportEntry> {
  const date = file.replace(".md", "");
  const raw = await readFile(path.join(readwiseDir, file), "utf8");
  const parsed = matter(raw);
  const fm = parsed.data as { title?: string; summary?: string; tags?: string[] };

  const counts = parseReadwiseStats(parsed.content);
  return {
    date,
    href: `${date}.md`,
    title: fm.title || `Readwise Daily ${date}`,
    summary: fm.summary ? truncate(fm.summary) : "",
    stats: counts,
  };
}

function parseReadwiseStats(body: string): string {
  const inputMatch = body.match(/\*\*输入\*\*\s*\n+\s*(\d+)\s*条/);
  const worthMatch = body.match(/\*\*值得读\*\*\s*\n+\s*([^\n]+)/);
  const parts: string[] = [];
  if (inputMatch) parts.push(`${inputMatch[1]} 条`);
  if (worthMatch) parts.push(worthMatch[1].replace(/\s+/g, " ").trim());
  return parts.join(" · ");
}

async function readHn(file: string): Promise<ReportEntry> {
  const date = file.replace(".md", "");
  const raw = await readFile(path.join(hnDir, file), "utf8");
  const title = raw.match(/^#\s+(.+)$/m)?.[1]?.trim() || `HN Digest ${date}`;
  const highlights = raw.match(/##\s+📝[^\n]*\n+([\s\S]*?)(?=\n---|\n##\s|$)/)?.[1] || "";
  const mustReadCount = (raw.match(/##\s+🏆[^\n]*\n+([\s\S]*?)(?=\n##\s|$)/)?.[1].match(/^🥇|^🥈|^🥉/gm) || []).length;
  const totalStories = (raw.match(/^####?\s+\d+\.\s+/gm) || []).length;
  const stats: string[] = [];
  if (totalStories) stats.push(`${totalStories} 篇`);
  if (mustReadCount) stats.push(`${mustReadCount} 必读`);
  return {
    date,
    href: `${date}.md`,
    title,
    summary: highlights ? truncate(highlights, 200) : "",
    stats: stats.join(" · "),
  };
}

async function readEntries<T extends ReportEntry>(
  dir: string,
  reader: (file: string) => Promise<T>,
): Promise<T[]> {
  const files = await listDates(dir);
  return Promise.all(files.map((f) => reader(f)));
}

function heroCard(source: "readwise" | "hn", entry: ReportEntry | undefined): string {
  const meta = {
    readwise: { icon: "📚", label: "Readwise Daily", folder: "readwise" },
    hn: { icon: "📰", label: "HN Tech Digest", folder: "hn" },
  }[source];

  if (!entry) {
    return [
      `-   ${meta.icon} __${meta.label}__`,
      "",
      "    ---",
      "",
      `    *暂无报告*`,
    ].join("\n");
  }

  const lines: string[] = [];
  lines.push(`-   ${meta.icon} __${meta.label} · ${entry.date}__`);
  lines.push("");
  lines.push("    ---");
  lines.push("");
  if (entry.summary) {
    lines.push(`    ${entry.summary}`);
    lines.push("");
  }
  if (entry.stats) {
    lines.push(`    :material-chart-box-outline: ${entry.stats}`);
    lines.push("");
  }
  lines.push(`    [:octicons-arrow-right-24: 阅读](${meta.folder}/${entry.href})`);
  return lines.join("\n");
}

function heroCardOnIndex(entry: ReportEntry | undefined): string {
  if (!entry) {
    return ["-   __最新报告__", "", "    ---", "", "    *暂无报告*"].join("\n");
  }
  const lines: string[] = [];
  lines.push(`-   :material-star-shooting: __最新 · ${entry.date}__`);
  lines.push("");
  lines.push("    ---");
  lines.push("");
  if (entry.summary) {
    lines.push(`    ${entry.summary}`);
    lines.push("");
  }
  if (entry.stats) {
    lines.push(`    :material-chart-box-outline: ${entry.stats}`);
    lines.push("");
  }
  lines.push(`    [:octicons-arrow-right-24: 阅读完整报告](${entry.href})`);
  return lines.join("\n");
}

function buildDashboard(readwise: ReportEntry[], hn: ReportEntry[]): string {
  const readwiseLatest = readwise[0];
  const hnLatest = hn[0];

  const recent: { date: string; readwise?: ReportEntry; hn?: ReportEntry }[] = [];
  const dates = Array.from(new Set([...readwise.map((r) => r.date), ...hn.map((r) => r.date)]))
    .sort()
    .reverse()
    .slice(0, 7);
  for (const d of dates) {
    recent.push({
      date: d,
      readwise: readwise.find((r) => r.date === d),
      hn: hn.find((h) => h.date === d),
    });
  }

  const recentRows = recent
    .map((row) => {
      const left = row.readwise ? `[📚 Readwise](readwise/${row.readwise.href})` : "—";
      const right = row.hn ? `[📰 HN](hn/${row.hn.href})` : "—";
      return `| ${row.date} | ${left} | ${right} |`;
    })
    .join("\n");

  return [
    "---",
    "title: Dashboard",
    "hide:",
    "  - navigation",
    "---",
    "",
    "# Reading Dashboard",
    "",
    "本站每天聚合两个阅读源 — Readwise 的高亮稿件，以及 Karpathy 精选 HN 技术博客的 RSS。",
    "",
    "## 今日速览",
    "",
    "<div class=\"grid cards\" markdown>",
    "",
    heroCard("readwise", readwiseLatest),
    "",
    heroCard("hn", hnLatest),
    "",
    "</div>",
    "",
    "## 最近 7 天",
    "",
    "| 日期 | Readwise | HN |",
    "| --- | --- | --- |",
    recentRows || "| — | — | — |",
    "",
    "## 主题入口",
    "",
    "<div class=\"grid cards\" markdown>",
    "",
    "-   :material-robot-outline: [__AI__](topics/ai.md)",
    "-   :material-code-tags: [__Programming__](topics/programming.md)",
    "-   :material-briefcase-outline: [__Career__](topics/career.md)",
    "-   :material-chart-line: [__Business__](topics/business.md)",
    "-   :material-translate: [__English__](topics/english.md)",
    "-   :material-syllabary-hiragana: [__Japanese__](topics/japanese.md)",
    "-   :material-dots-horizontal: [__Other__](topics/other.md)",
    "",
    "</div>",
    "",
    "## 系统原则",
    "",
    "- Discord 只发摘要和链接，不塞长文。",
    "- Markdown 是长期知识库，适合搜索、回看、沉淀。",
    "- 本地文件化，不依赖重数据库。",
    "- 小而稳定，能每天跑，不把自己变成赛博盆栽。",
    "",
  ].join("\n");
}

function groupByMonth(entries: ReportEntry[]): { month: string; rows: ReportEntry[] }[] {
  const groups = new Map<string, ReportEntry[]>();
  for (const e of entries) {
    const month = e.date.slice(0, 7);
    if (!groups.has(month)) groups.set(month, []);
    groups.get(month)!.push(e);
  }
  return Array.from(groups.entries())
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([month, rows]) => ({ month, rows }));
}

function buildSourceIndex(
  title: string,
  intro: string,
  entries: ReportEntry[],
): string {
  const latest = entries[0];
  const grouped = groupByMonth(entries);
  const sections = grouped
    .map(({ month, rows }) => {
      const rowsMd = rows
        .map((r) => {
          const stats = r.stats ? ` · ${r.stats}` : "";
          const summary = r.summary ? `<br/><span class=\"md-typeset__small\">${r.summary}</span>` : "";
          return `- [${r.date}](${r.href})${stats}${summary}`;
        })
        .join("\n");
      return `### ${month}\n\n${rowsMd}`;
    })
    .join("\n\n");

  return [
    `# ${title}`,
    "",
    intro,
    "",
    "## 最新",
    "",
    "<div class=\"grid cards\" markdown>",
    "",
    heroCardOnIndex(latest),
    "",
    "</div>",
    "",
    "## 历史报告",
    "",
    sections || "*暂无报告*",
    "",
  ].join("\n");
}

function navBlock(folder: string, entries: ReportEntry[]): string {
  return entries
    .map((e) => `    - "${e.date}": ${folder}/${e.href}`)
    .join("\n");
}

async function updateNav(readwise: ReportEntry[], hn: ReportEntry[]): Promise<void> {
  const navPath = path.join(root, "mkdocs.yml");
  const original = await readFile(navPath, "utf8");
  const next = original
    .replace(
      /( {4}# AUTO_READWISE_START\n)[\s\S]*?( {4}# AUTO_READWISE_END)/,
      (_m, start: string, end: string) => `${start}${navBlock("readwise", readwise)}\n${end}`,
    )
    .replace(
      /( {4}# AUTO_HN_START\n)[\s\S]*?( {4}# AUTO_HN_END)/,
      (_m, start: string, end: string) => `${start}${navBlock("hn", hn)}\n${end}`,
    );
  if (next !== original) await writeFile(navPath, next);
}

const [readwiseEntries, hnEntries] = await Promise.all([
  readEntries(readwiseDir, readReadwise),
  readEntries(hnDir, readHn),
]);

await Promise.all([
  writeFile(path.join(root, "docs", "index.md"), buildDashboard(readwiseEntries, hnEntries)),
  writeFile(
    path.join(readwiseDir, "index.md"),
    buildSourceIndex(
      "📚 Readwise Daily",
      "Readwise highlights 和 Reader 新增内容的每日分类报告。",
      readwiseEntries,
    ),
  ),
  writeFile(
    path.join(hnDir, "index.md"),
    buildSourceIndex(
      "📰 HN Tech Blog Digest",
      "来自 92 个 HN Karpathy 精选博客的 RSS，每日 AI 评分排序的 Top 15。",
      hnEntries,
    ),
  ),
  updateNav(readwiseEntries, hnEntries),
]);

console.log(
  `Indexes updated — ${readwiseEntries.length} Readwise / ${hnEntries.length} HN reports`,
);
