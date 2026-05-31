import type { ProcessedArticle } from "./types.js";

function formatDateTime(iso: string, timezone: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  try {
    const parts = new Intl.DateTimeFormat("sv-SE", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(d);
    return `${parts} JST`;
  } catch {
    return d.toISOString().slice(0, 16).replace("T", " ");
  }
}

function authorUrl(article: ProcessedArticle): string {
  return article.authorUrlname ? `https://note.com/${article.authorUrlname}` : article.url;
}

// Push every heading down so the shallowest sits at `baseLevel`, preserving the
// relative nesting. Keeps AI- and body-generated headings beneath the article's
// section headings instead of leaking into the report's top-level TOC.
function nestHeadings(md: string, baseLevel: number): string {
  const levels = [...md.matchAll(/^(#{1,6}) /gm)].map((m) => m[1].length);
  if (levels.length === 0) return md;
  const shift = baseLevel - Math.min(...levels);
  if (shift <= 0) return md;
  return md.replace(/^(#{1,6}) /gm, (_m, hashes: string) => "#".repeat(Math.min(6, hashes.length + shift)) + " ");
}

// Escape characters in the YAML frontmatter summary string.
function yamlString(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function renderArticle(article: ProcessedArticle, index: number, timezone: string): string {
  const tags = article.hashtags.map((t) => `#${t}`).join(" ");
  const published = formatDateTime(article.publishAt, timezone);
  const meta = [
    `**作者** [${article.authorName}](${authorUrl(article)})`,
    `❤️ ${article.likeCount}`,
    published && `🗓 ${published}`,
    tags && `🏷 ${tags}`,
    `[note で読む](${article.url})`,
  ]
    .filter(Boolean)
    .join(" ・ ");

  // Article titles are H2; section labels below are H3 — so any headings inside
  // the AI output or the original body are nested at H4+.
  const summary = article.summaryZh ? nestHeadings(article.summaryZh, 4) : "_（AI 摘要生成失败，请直接阅读下方全文。）_";
  const rewrite = article.rewriteJa
    ? nestHeadings(article.rewriteJa, 4)
    : "_（AI によるやさしい日本語版の生成に失敗しました。下の全文をご覧ください。）_";
  const body = article.bodyMarkdown ? nestHeadings(article.bodyMarkdown, 4) : "_（本文を取得できませんでした。）_";
  const truncatedNote = article.bodyTruncated
    ? "\n\n> ⚠️ 本文が長いため、やさしい日本語版は前半を中心にカバーしています。\n"
    : "";

  return [
    `## ${index}. ${article.title}`,
    "",
    meta,
    "",
    "### 📌 中文摘要",
    "",
    summary,
    "",
    "### 🟢 やさしい日本語（N3–N2）",
    "",
    rewrite,
    truncatedNote,
    "",
    "### 📖 全文（原文）",
    "",
    body,
    "",
    "---",
    "",
  ].join("\n");
}

export interface RenderParams {
  date: string;
  timezone: string;
  hashtags: string[];
  articles: ProcessedArticle[];
  skippedCount: number;
}

export function renderReport({ date, timezone, hashtags, articles, skippedCount }: RenderParams): string {
  const tagLine = hashtags.map((t) => `#${t}`).join(" ");
  const titles = articles.map((a) => a.title).join(" / ");
  const summary = articles.length
    ? `今日 note.com の人気 AI 記事 ${articles.length} 本：${titles}`
    : "過去 24 時間に該当する新着の人気 AI 記事はありませんでした。";

  const degradedCount = articles.filter((a) => a.aiStatus !== "ok").length;

  const header = [
    "---",
    `title: note AI 日本語ダイジェスト ${date}`,
    `date: ${date}`,
    `summary: "${yamlString(summary).slice(0, 280)}"`,
    "---",
    "",
    `# 🇯🇵 note AI 日本語ダイジェスト — ${date}`,
    "",
    `> note.com で過去 24 時間に人気の AI 記事｜タグ: ${tagLine}`,
    "> 各記事：① 中文摘要 ② やさしい日本語 (N3–N2) ③ 全文（原文）",
    "",
  ];

  if (degradedCount > 0) {
    header.push(
      `!!! warning "一部の AI 生成に失敗"`,
      `    ${degradedCount} 本の記事で要約または書き換えに失敗しました。該当箇所は全文をご参照ください。`,
      "",
    );
  }

  if (articles.length === 0) {
    header.push(
      "今日は対象タグで新しく人気になった無料の AI 記事が見つかりませんでした。",
      "",
    );
    return header.join("\n");
  }

  const body = articles.map((a, i) => renderArticle(a, i + 1, timezone)).join("\n");

  const footer = skippedCount > 0 ? [`> ℹ️ ${skippedCount} 本は既出のためスキップしました。`, ""] : [];

  return [...header, "---", "", body, ...footer].join("\n");
}
