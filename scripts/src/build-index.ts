import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import matter from "gray-matter";
import YAML from "yaml";
import { loadRegistry, type SkillEntry } from "./kernel/registry.js";

const root = process.cwd();
const DATE_RE = /^\d{4}-\d{2}-\d{2}\.md$/;

type ReportEntry = {
  date: string;
  href: string;
  title: string;
  summary: string;
};

function truncate(text: string, max = 180): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  return clean.slice(0, max).replace(/[，,。.；;]\s*\S*$/, "") + "…";
}

function skillFolder(skill: SkillEntry): string {
  return skill.manifest.id;
}

function skillDir(skill: SkillEntry): string {
  return `docs/${skill.manifest.id}`;
}

async function readSkillEntries(skill: SkillEntry): Promise<ReportEntry[]> {
  const dir = path.join(root, skillDir(skill));
  let files: string[];
  try {
    files = await readdir(dir);
  } catch {
    return [];
  }
  const dated = files.filter((f) => DATE_RE.test(f)).sort().reverse();
  return Promise.all(
    dated.map(async (file) => {
      const date = file.replace(".md", "");
      const raw = await readFile(path.join(dir, file), "utf8");
      const parsed = matter(raw);
      const fm = parsed.data as { title?: string; summary?: string };
      const titleFromH1 = parsed.content.match(/^#\s+(.+)$/m)?.[1]?.trim();
      return {
        date,
        href: `${date}.md`,
        title: fm.title ?? titleFromH1 ?? `${skill.manifest.title} ${date}`,
        summary: fm.summary ? truncate(fm.summary) : "",
      };
    }),
  );
}

function heroCard(skill: SkillEntry, entry: ReportEntry | undefined): string {
  const icon = skill.manifest.output?.icon ?? "📄";
  const label = skill.manifest.title;
  const folder = skillFolder(skill);

  if (!entry) {
    return [`-   ${icon} __${label}__`, "", "    ---", "", "    *暂无报告*"].join("\n");
  }

  const lines = [
    `-   ${icon} __${label} · ${entry.date}__`,
    "",
    "    ---",
    "",
  ];
  if (entry.summary) lines.push(`    ${entry.summary}`, "");
  lines.push(`    [:octicons-arrow-right-24: 阅读](${folder}/${entry.href})`);
  return lines.join("\n");
}

function heroCardOnIndex(entry: ReportEntry | undefined): string {
  if (!entry) {
    return ["-   __最新报告__", "", "    ---", "", "    *暂无报告*"].join("\n");
  }
  const lines = [
    `-   :material-star-shooting: __最新 · ${entry.date}__`,
    "",
    "    ---",
    "",
  ];
  if (entry.summary) lines.push(`    ${entry.summary}`, "");
  lines.push(`    [:octicons-arrow-right-24: 阅读完整报告](${entry.href})`);
  return lines.join("\n");
}

function buildDashboard(skills: SkillEntry[], entriesBySkill: Map<string, ReportEntry[]>): string {
  const heroCards = skills
    .map((s) => heroCard(s, entriesBySkill.get(s.manifest.id)?.[0]))
    .join("\n\n");

  const allDates = new Set<string>();
  for (const entries of entriesBySkill.values()) {
    for (const e of entries) allDates.add(e.date);
  }
  const recent = [...allDates].sort().reverse().slice(0, 7);

  const headerRow = ["日期", ...skills.map((s) => s.manifest.title)];
  const dividerRow = headerRow.map(() => "---");
  const dataRows = recent.map((d) => {
    const cells = [
      d,
      ...skills.map((s) => {
        const entry = entriesBySkill.get(s.manifest.id)?.find((e) => e.date === d);
        if (!entry) return "—";
        const icon = s.manifest.output?.icon ?? "📄";
        return `[${icon} ${s.manifest.title}](${skillFolder(s)}/${entry.href})`;
      }),
    ];
    return "| " + cells.join(" | ") + " |";
  });
  const tableRows = [
    "| " + headerRow.join(" | ") + " |",
    "| " + dividerRow.join(" | ") + " |",
    dataRows.length ? dataRows.join("\n") : "| " + headerRow.map(() => "—").join(" | ") + " |",
  ].join("\n");

  const titles = skills.map((s) => s.manifest.title).join("、");

  return [
    "---",
    "title: Dashboard",
    "hide:",
    "  - navigation",
    "---",
    "",
    "# Reading Dashboard",
    "",
    `本站每天聚合 ${skills.length} 个数据源（${titles}），每日生成结构化阅读报告。`,
    "",
    "## 今日速览",
    "",
    '<div class="grid cards" markdown>',
    "",
    heroCards,
    "",
    "</div>",
    "",
    "## 最近 7 天",
    "",
    tableRows,
    "",
    "## 主题入口",
    "",
    '<div class="grid cards" markdown>',
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

function buildSkillIndex(skill: SkillEntry, entries: ReportEntry[]): string {
  const latest = entries[0];
  const grouped = groupByMonth(entries);
  const sections = grouped
    .map(({ month, rows }) => {
      const rowsMd = rows
        .map((r) => {
          const summary = r.summary ? `<br/><span class="md-typeset__small">${r.summary}</span>` : "";
          return `- [${r.date}](${r.href})${summary}`;
        })
        .join("\n");
      return `### ${month}\n\n${rowsMd}`;
    })
    .join("\n\n");

  const icon = skill.manifest.output?.icon ?? "📄";
  const title = `${icon} ${skill.manifest.title}`;
  const intro = skill.manifest.description ?? "";

  return [
    `# ${title}`,
    "",
    intro,
    "",
    "## 最新",
    "",
    '<div class="grid cards" markdown>',
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

type NavEntry = string | { [key: string]: string | NavEntry[] };

function buildNav(skills: SkillEntry[], entriesBySkill: Map<string, ReportEntry[]>): NavEntry[] {
  const nav: NavEntry[] = [{ Dashboard: "index.md" }];

  for (const skill of skills) {
    const folder = skillFolder(skill);
    const items: NavEntry[] = [`${folder}/index.md`];
    for (const entry of entriesBySkill.get(skill.manifest.id) ?? []) {
      items.push({ [entry.date]: `${folder}/${entry.href}` });
    }
    nav.push({ [skill.manifest.title]: items });
  }

  nav.push({
    Topics: [
      "topics/index.md",
      { AI: "topics/ai.md" },
      { Programming: "topics/programming.md" },
      { Career: "topics/career.md" },
      { Business: "topics/business.md" },
      { English: "topics/english.md" },
      { Japanese: "topics/japanese.md" },
      { Other: "topics/other.md" },
    ],
  });
  nav.push({
    Archive: [
      { Weekly: "weekly/index.md" },
      { Monthly: "monthly/index.md" },
    ],
  });

  return nav;
}

async function rewriteNav(skills: SkillEntry[], entriesBySkill: Map<string, ReportEntry[]>): Promise<void> {
  const navPath = path.join(root, "mkdocs.yml");
  const text = await readFile(navPath, "utf8");
  const doc = YAML.parseDocument(text);

  doc.set("nav", buildNav(skills, entriesBySkill));

  const output = doc.toString({ lineWidth: 0 });
  if (output !== text) await writeFile(navPath, output);
}

const registry = await loadRegistry();
const skills = registry.filter((s) => s.manifest.enabled !== false);
const entriesBySkill = new Map<string, ReportEntry[]>();
for (const skill of skills) {
  entriesBySkill.set(skill.manifest.id, await readSkillEntries(skill));
}

await Promise.all([
  writeFile(path.join(root, "docs", "index.md"), buildDashboard(skills, entriesBySkill)),
  ...skills.map(async (skill) => {
    const entries = entriesBySkill.get(skill.manifest.id) ?? [];
    const indexPath = path.join(root, skillDir(skill), "index.md");
    await writeFile(indexPath, buildSkillIndex(skill, entries));
  }),
  rewriteNav(skills, entriesBySkill),
]);

const counts = skills.map((s) => `${entriesBySkill.get(s.manifest.id)?.length ?? 0} ${s.manifest.id}`).join(" / ");
console.log(`Indexes updated — ${counts}`);
