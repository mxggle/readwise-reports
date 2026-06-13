import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import matter from "gray-matter";
import YAML from "yaml";
import { loadRegistry, type SkillEntry } from "./kernel/registry.js";

const root = process.cwd();
const DATE_RE = /^\d{4}-\d{2}-\d{2}\.md$/;
const TOPICS = ["AI", "Programming", "Career", "Business", "English", "Japanese", "Other"] as const;

type Topic = (typeof TOPICS)[number];

type ReportEntry = {
  date: string;
  href: string;
  title: string;
  summary: string;
};

export type TopicItem = {
  topic: Topic;
  date: string;
  title: string;
  url: string;
  reportHref: string;
  action: string;
  score: string;
  reason: string;
};

// Reduce report-summary markdown to clean prose so it can sit safely inside a
// dashboard card's plain-text slot (no leaked headings, bold markers, or links).
function stripMarkdown(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, " ") // fenced code
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ") // images
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1") // links → label
    .replace(/^\s{0,3}#{1,6}\s+/gm, "") // ATX headings
    .replace(/^\s{0,3}>\s?/gm, "") // blockquotes
    .replace(/^\s{0,3}[-*+]\s+/gm, "") // list bullets
    .replace(/(\*\*|__)(.*?)\1/g, "$2") // bold
    .replace(/(\*|_)(.*?)\1/g, "$2") // italic
    .replace(/`([^`]*)`/g, "$1") // inline code
    .replace(/[*_`#>¶]/g, "") // stray/unbalanced markers
    .replace(/\s+/g, " ")
    .trim();
}

function truncate(text: string, max = 180): string {
  const clean = stripMarkdown(text);
  if (clean.length <= max) return clean;
  return clean.slice(0, max).replace(/[，,。.；;]\s*\S*$/, "") + "…";
}

function isTopic(value: string): value is Topic {
  return TOPICS.includes(value as Topic);
}

function cleanReportHeading(text: string): string {
  return text
    .replace(/^\d+\.\s+/, "")
    .replace(/^[\p{Emoji_Presentation}\p{Extended_Pictographic}\uFE0F]+\s*/u, "")
    .trim();
}

function markdownListLink(title: string, url: string): string {
  return `[${title.replace(/]/g, "\\]")}](${url})`;
}

// MkDocs only rewrites `.md` links written in Markdown syntax; links inside
// raw-HTML blocks (our cards / archive table) are emitted verbatim. With
// use_directory_urls (the default) a page `foo/bar.md` is served at `foo/bar/`,
// so we must convert hrefs ourselves or the browser 404s on the literal `.md`.
export function mdToUrl(href: string): string {
  if (!href.endsWith(".md")) return href;
  const noExt = href.slice(0, -3);
  if (noExt === "index") return "./";
  if (noExt.endsWith("/index")) return noExt.slice(0, -"index".length);
  return `${noExt}/`;
}

// Summaries and titles flow into generated raw-HTML blocks (cards, archive
// table); escape them so stray angle brackets can't break the page.
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function cleanInlineText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function collectTopicItemsFromReport(report: ReportEntry, markdown: string): TopicItem[] {
  const items: TopicItem[] = [];
  const reportHref = `../readwise/${report.href}`;
  const headingRe = /^###\s+(.+)$/gm;
  const headings = [...markdown.matchAll(headingRe)];

  for (let i = 0; i < headings.length; i++) {
    const match = headings[i];
    const title = cleanReportHeading(match[1]);
    const start = (match.index ?? 0) + match[0].length;
    const end = headings[i + 1]?.index ?? markdown.length;
    const block = markdown.slice(start, end);
    const topic = block.match(/^- \*\*主题\*\*：(.+)$/m)?.[1]?.trim();
    if (!topic || !isTopic(topic)) continue;

    items.push({
      topic,
      date: report.date,
      title: cleanInlineText(title),
      url: block.match(/^- \*\*链接\*\*：\[[^\]]+\]\(([^)]+)\)/m)?.[1]?.trim() || reportHref,
      reportHref,
      action: block.match(/^- \*\*动作\*\*：`?([^`\n]+)`?/m)?.[1]?.trim() || "",
      score: block.match(/^- \*\*分数\*\*：([^ \n]+\/100)/m)?.[1]?.trim() || "",
      reason: cleanInlineText(block.match(/^- \*\*理由\*\*：(.+)$/m)?.[1] || ""),
    });
  }

  const listRe = /^- \*\*\[([^\]]+)\] \[([^\]]+)\]\(([^)]+)\)\*\*：([^\n]*)/gm;
  for (const match of markdown.matchAll(listRe)) {
    const topic = match[1].trim();
    if (!isTopic(topic)) continue;
    items.push({
      topic,
      date: report.date,
      title: cleanInlineText(match[2]),
      url: match[3].trim(),
      reportHref,
      action: "",
      score: "",
      reason: cleanInlineText(match[4]),
    });
  }

  return items;
}

export function buildTopicPage(topic: Topic, items: TopicItem[]): string {
  const sorted = [...items].sort((a, b) => b.date.localeCompare(a.date) || a.title.localeCompare(b.title));
  const grouped = new Map<string, TopicItem[]>();
  for (const item of sorted) {
    const month = item.date.slice(0, 7);
    if (!grouped.has(month)) grouped.set(month, []);
    grouped.get(month)!.push(item);
  }

  const sections = [...grouped.entries()]
    .map(([month, monthItems]) => {
      const byDate = new Map<string, TopicItem[]>();
      for (const item of monthItems) {
        if (!byDate.has(item.date)) byDate.set(item.date, []);
        byDate.get(item.date)!.push(item);
      }
      const dates = [...byDate.entries()]
        .map(([date, dateItems]) => {
          const rows = dateItems
            .map((item) => {
              // Title on its own line; action/score/reason demoted to a muted
              // meta line so the list scans by title.
              const meta = [item.action ? `\`${item.action}\`` : "", item.score, `[日报](${item.reportHref})`]
                .filter(Boolean)
                .join(" · ");
              const reason = item.reason ? ` · ${item.reason}` : "";
              const metaLine = meta || reason ? `<br><small class="rw-item-meta">${meta}${reason}</small>` : "";
              return `- ${markdownListLink(item.title, item.url)}${metaLine}`;
            })
            .join("\n");
          return `### ${date}\n\n${rows}`;
        })
        .join("\n\n");
      return `## ${month}\n\n${dates}`;
    })
    .join("\n\n");

  return [
    `# ${topic}`,
    "",
    `最近 Readwise 日报中归入 **${topic}** 的条目。`,
    "",
    sections || "*暂无条目*",
    "",
  ].join("\n");
}

const TOPIC_ICON: Record<Topic, string> = {
  AI: "🤖",
  Programming: "💻",
  Career: "💼",
  Business: "📈",
  English: "🔤",
  Japanese: "🇯🇵",
  Other: "🗂️",
};

// Topic landing page: one card per topic showing how many items it holds and
// the most recent few titles, so each topic is browsable at a glance instead
// of a bare list of links.
function buildTopicsIndex(items: TopicItem[]): string {
  const byTopic = new Map<Topic, TopicItem[]>();
  for (const item of items) {
    if (!byTopic.has(item.topic)) byTopic.set(item.topic, []);
    byTopic.get(item.topic)!.push(item);
  }

  const cards = TOPICS.map((topic) => {
    const topicItems = (byTopic.get(topic) ?? []).slice().sort((a, b) => b.date.localeCompare(a.date));
    const count = topicItems.length;
    const preview = topicItems
      .slice(0, 3)
      .map((i) => `<span class="rw-topic__item">${escapeHtml(i.title)}</span>`)
      .join("");
    const countLabel = count ? `${count} 条` : "暂无";
    return [
      `<a class="rw-card rw-topic" href="${mdToUrl(`${topic.toLowerCase()}.md`)}">`,
      `  <span class="rw-card__head"><span class="rw-card__source">${TOPIC_ICON[topic]} ${topic}</span><span class="rw-card__date">${countLabel}</span></span>`,
      preview ? `  <span class="rw-topic__items">${preview}</span>` : "",
      "</a>",
    ]
      .filter(Boolean)
      .join("\n");
  }).join("\n");

  return [
    "---",
    "title: Topics",
    "hide:",
    "  - toc",
    "---",
    "",
    "# Topics",
    "",
    "Readwise 日报中的条目按主题归档。",
    "",
    '<div class="rw-cards">',
    cards,
    "</div>",
    "",
  ].join("\n");
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

// Fully clickable report card. mkdocs rewrites relative `.md` hrefs in the
// final HTML tree, so linking to source files works inside raw HTML too.
function reportCard(skill: SkillEntry, entry: ReportEntry | undefined, hrefPrefix: string): string {
  const icon = skill.manifest.output?.icon ?? "📄";
  const label = escapeHtml(skill.manifest.title);

  if (!entry) {
    return [
      '<div class="rw-card rw-card--empty">',
      `  <span class="rw-card__source">${icon} ${label}</span>`,
      '  <span class="rw-card__summary">暂无报告</span>',
      "</div>",
    ].join("\n");
  }

  const summary = entry.summary ? escapeHtml(entry.summary) : "阅读当日完整报告";
  return [
    `<a class="rw-card" href="${mdToUrl(`${hrefPrefix}${entry.href}`)}">`,
    `  <span class="rw-card__head"><span class="rw-card__source">${icon} ${label}</span><time class="rw-card__date">${entry.date}</time></span>`,
    `  <span class="rw-card__summary">${summary}</span>`,
    '  <span class="rw-card__cta">阅读报告 →</span>',
    "</a>",
  ].join("\n");
}

const TOPIC_CHIPS: ReadonlyArray<{ topic: Topic; href: string }> = TOPICS.map((topic) => ({
  topic,
  href: `topics/${topic.toLowerCase()}.md`,
}));

function buildArchiveTable(skills: SkillEntry[], entriesBySkill: Map<string, ReportEntry[]>): string {
  const allDates = new Set<string>();
  for (const entries of entriesBySkill.values()) {
    for (const e of entries) allDates.add(e.date);
  }
  const recent = [...allDates].sort().reverse().slice(0, 7);
  if (recent.length === 0) return "*暂无报告*";

  const head = ["日期", ...skills.map((s) => escapeHtml(s.manifest.title))]
    .map((h) => `<th>${h}</th>`)
    .join("");
  const rows = recent
    .map((d) => {
      const cells = skills
        .map((s) => {
          const entry = entriesBySkill.get(s.manifest.id)?.find((e) => e.date === d);
          if (!entry) return '<td class="rw-archive__miss">—</td>';
          const icon = s.manifest.output?.icon ?? "📄";
          const label = escapeHtml(`${s.manifest.title} · ${d}`);
          return `<td><a href="${mdToUrl(`${skillFolder(s)}/${entry.href}`)}" title="${label}" aria-label="${label}">${icon}</a></td>`;
        })
        .join("");
      return `<tr><td class="rw-archive__date">${d}</td>${cells}</tr>`;
    })
    .join("\n");

  return [
    '<table class="rw-archive">',
    `<thead><tr>${head}</tr></thead>`,
    "<tbody>",
    rows,
    "</tbody>",
    "</table>",
  ].join("\n");
}

function buildDashboard(skills: SkillEntry[], entriesBySkill: Map<string, ReportEntry[]>): string {
  const cards = skills
    .map((s) => reportCard(s, entriesBySkill.get(s.manifest.id)?.[0], `${skillFolder(s)}/`))
    .join("\n");

  const chips = TOPIC_CHIPS.map(({ topic, href }) => `<a href="${mdToUrl(href)}">${topic}</a>`).join("\n");

  return [
    "---",
    "title: Dashboard",
    "hide:",
    "  - navigation",
    "  - toc",
    "---",
    "",
    "# Reading Dashboard",
    "",
    `每天从 ${skills.length} 个数据源生成结构化阅读报告。`,
    "",
    "## 最新报告",
    "",
    '<div class="rw-cards">',
    cards,
    "</div>",
    "",
    "## 主题",
    "",
    '<nav class="rw-chips" aria-label="主题入口">',
    chips,
    "</nav>",
    "",
    "## 最近 7 天",
    "",
    buildArchiveTable(skills, entriesBySkill),
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
  // The latest report is the hero card; the history list starts from the
  // second entry so the same report never appears twice on one page.
  const grouped = groupByMonth(entries.slice(1));
  const sections = grouped
    .map(({ month, rows }) => {
      const rowsMd = rows
        .map((r) => {
          const summary = r.summary ? `<br><small class="rw-item-meta">${escapeHtml(r.summary)}</small>` : "";
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
    '<div class="rw-cards rw-cards--single">',
    reportCard(skill, latest, ""),
    "</div>",
    "",
    "## 更早",
    "",
    sections || "*暂无更早的报告*",
    "",
  ].join("\n");
}

type NavEntry = string | { [key: string]: string | NavEntry[] };

function buildNav(skills: SkillEntry[], entriesBySkill: Map<string, ReportEntry[]>): NavEntry[] {
  const nav: NavEntry[] = [{ Dashboard: "index.md" }];

  for (const skill of skills) {
    const folder = skillFolder(skill);
    const items: NavEntry[] = [`${folder}/index.md`];
    // Group dated reports by month so the sidebar stays scannable as the
    // archive grows, instead of one flat list of bare dates.
    for (const { month, rows } of groupByMonth(entriesBySkill.get(skill.manifest.id) ?? [])) {
      items.push({ [month]: rows.map((entry) => ({ [entry.date]: `${folder}/${entry.href}` })) });
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

async function collectAllTopicItems(readwiseEntries: ReportEntry[]): Promise<TopicItem[]> {
  const items: TopicItem[] = [];
  for (const entry of readwiseEntries) {
    const markdown = await readFile(path.join(root, "docs", "readwise", entry.href), "utf8");
    items.push(...collectTopicItemsFromReport(entry, markdown));
  }
  return items;
}

async function writeTopicPages(readwiseEntries: ReportEntry[]): Promise<void> {
  const topicDir = path.join(root, "docs", "topics");
  await mkdir(topicDir, { recursive: true });
  const topicItems = await collectAllTopicItems(readwiseEntries);
  await Promise.all([
    writeFile(path.join(topicDir, "index.md"), buildTopicsIndex(topicItems)),
    ...TOPICS.map((topic) =>
      writeFile(
        path.join(topicDir, `${topic.toLowerCase()}.md`),
        buildTopicPage(
          topic,
          topicItems.filter((item) => item.topic === topic),
        ),
      ),
    ),
  ]);
}

export async function buildIndexes(): Promise<string> {
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
    writeTopicPages(entriesBySkill.get("readwise") ?? []),
    rewriteNav(skills, entriesBySkill),
  ]);

  return skills.map((s) => `${entriesBySkill.get(s.manifest.id)?.length ?? 0} ${s.manifest.id}`).join(" / ");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const counts = await buildIndexes();
  console.log(`Indexes updated — ${counts}`);
}
