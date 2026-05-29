import { CATEGORY_META } from "./types.js";
import type { AiStatus, CategoryId, ScoredArticle } from "./types.js";

// ============================================================================
// Visualization Helpers
// ============================================================================

function humanizeTime(pubDate: Date): string {
  const diffMs = Date.now() - pubDate.getTime();
  const diffMins = Math.floor(diffMs / 60_000);
  const diffHours = Math.floor(diffMs / 3_600_000);
  const diffDays = Math.floor(diffMs / 86_400_000);

  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays} days ago`;
  return pubDate.toISOString().slice(0, 10);
}

/** Count keyword occurrences across articles, sorted desc and capped at `limit`. */
function keywordCounts(articles: ScoredArticle[], limit: number): Array<[string, number]> {
  const kwCount = new Map<string, number>();
  for (const a of articles) {
    for (const kw of a.keywords) {
      const normalized = kw.toLowerCase();
      kwCount.set(normalized, (kwCount.get(normalized) || 0) + 1);
    }
  }
  return Array.from(kwCount.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit);
}

function generateKeywordBarChart(articles: ScoredArticle[]): string {
  const sorted = keywordCounts(articles, 12);
  if (sorted.length === 0) return "";

  const labels = sorted.map(([k]) => `"${k}"`).join(", ");
  const values = sorted.map(([, v]) => v).join(", ");
  const maxVal = sorted[0][1];

  let chart = "```mermaid\n";
  chart += `xychart-beta horizontal\n`;
  chart += `    title "Frequency Keywords"\n`;
  chart += `    x-axis [${labels}]\n`;
  chart += `    y-axis "Occurrences" 0 --> ${maxVal + 2}\n`;
  chart += `    bar [${values}]\n`;
  chart += "```\n";

  return chart;
}

function generateCategoryPieChart(articles: ScoredArticle[]): string {
  const catCount = new Map<CategoryId, number>();
  for (const a of articles) {
    catCount.set(a.category, (catCount.get(a.category) || 0) + 1);
  }

  if (catCount.size === 0) return "";

  const sorted = Array.from(catCount.entries()).sort((a, b) => b[1] - a[1]);

  let chart = "```mermaid\n";
  chart += `pie showData\n`;
  chart += `    title "Article Category Distribution"\n`;
  for (const [cat, count] of sorted) {
    const meta = CATEGORY_META[cat];
    chart += `    "${meta.emoji} ${meta.label}" : ${count}\n`;
  }
  chart += "```\n";

  return chart;
}

function generateAsciiBarChart(articles: ScoredArticle[]): string {
  const sorted = keywordCounts(articles, 10);
  if (sorted.length === 0) return "";

  const maxVal = sorted[0][1];
  const maxBarWidth = 20;
  const maxLabelLen = Math.max(...sorted.map(([k]) => k.length));

  let chart = "```\n";
  for (const [label, value] of sorted) {
    const barLen = Math.max(1, Math.round((value / maxVal) * maxBarWidth));
    const bar = "█".repeat(barLen) + "░".repeat(maxBarWidth - barLen);
    chart += `${label.padEnd(maxLabelLen)} │ ${bar} ${value}\n`;
  }
  chart += "```\n";

  return chart;
}

function generateTagCloud(articles: ScoredArticle[]): string {
  const sorted = keywordCounts(articles, 20);
  if (sorted.length === 0) return "";

  return sorted
    .map(([word, count], i) => (i < 3 ? `**${word}**(${count})` : `${word}(${count})`))
    .join(" · ");
}

// ============================================================================
// Report Generation
// ============================================================================

export interface DigestStats {
  totalFeeds: number;
  successFeeds: number;
  totalArticles: number;
  filteredArticles: number;
  hours: number;
  dateStr: string;
  aiStatus: AiStatus;
}

export function generateDigestReport(articles: ScoredArticle[], highlights: string, stats: DigestStats): string {
  const summaryLine = highlights ? highlights.replace(/\n/g, " ").replace(/"/g, "'").slice(0, 280) : "";
  const degraded = stats.aiStatus !== "ok";
  const fmFields = [
    `title: AI Blog Daily Digest ${stats.dateStr}`,
    `date: ${stats.dateStr}`,
    summaryLine ? `summary: "${summaryLine}"` : "",
    degraded ? `degraded: true` : "",
  ].filter(Boolean);
  // Trailing '', '' produces the closing '---' plus a blank line before the
  // heading. Do not filter these out — they are load-bearing newlines.
  const frontmatter = ["---", ...fmFields, "---", "", ""].join("\n");

  let report = frontmatter;
  report += `# 📰 AI Blog Daily Digest — ${stats.dateStr}\n\n`;
  if (degraded) {
    const detail =
      stats.aiStatus === "failed"
        ? "AI scoring failed for every batch — rankings and categories below are placeholder defaults, not AI-judged."
        : "AI scoring failed for some batches — a subset of rankings and categories below are placeholder defaults.";
    report += `> ⚠️ **Degraded run.** ${detail}\n\n`;
  }
  report += `> From ${stats.totalFeeds} top tech blogs (curated by Karpathy), AI-selected Top ${articles.length}\n\n`;

  if (highlights) {
    report += `## 📝 Today's Highlights\n\n`;
    report += `${highlights}\n\n`;
    report += `---\n\n`;
  }

  if (articles.length >= 3) {
    report += `## 🏆 Must Read\n\n`;
    for (let i = 0; i < Math.min(3, articles.length); i++) {
      const a = articles[i];
      const medal = ["🥇", "🥈", "🥉"][i];
      const catMeta = CATEGORY_META[a.category];

      report += `${medal} **${a.title}**\n\n`;
      report += `${a.sourceName} · ${humanizeTime(a.pubDate)} · ${catMeta.emoji} ${catMeta.label}\n\n`;
      report += `> ${a.summary}\n\n`;
      if (a.reason) {
        report += `💡 **Why it matters**: ${a.reason}\n\n`;
      }
      if (a.keywords.length > 0) {
        report += `🏷️ ${a.keywords.join(", ")}\n\n`;
      }
    }
    report += `---\n\n`;
  }

  report += `## 📊 Data Overview\n\n`;

  report += `| Scanned | Articles | Range | Selected |\n`;
  report += `|:---:|:---:|:---:|:---:|\n`;
  report += `| ${stats.successFeeds}/${stats.totalFeeds} | ${stats.totalArticles} → ${stats.filteredArticles} | ${stats.hours}h | **${articles.length}** |\n\n`;

  const pieChart = generateCategoryPieChart(articles);
  if (pieChart) {
    report += `### Category Distribution\n\n${pieChart}\n`;
  }

  const barChart = generateKeywordBarChart(articles);
  if (barChart) {
    report += `### High-Frequency Keywords\n\n${barChart}\n`;
  }

  const asciiChart = generateAsciiBarChart(articles);
  if (asciiChart) {
    report += `<details>\n<summary>📈 ASCII Keyword Chart (Terminal Friendly)</summary>\n\n${asciiChart}\n</details>\n\n`;
  }

  const tagCloud = generateTagCloud(articles);
  if (tagCloud) {
    report += `### 🏷️ Topic Tags\n\n${tagCloud}\n\n`;
  }

  report += `---\n\n`;

  const categoryGroups = new Map<CategoryId, ScoredArticle[]>();
  for (const a of articles) {
    const list = categoryGroups.get(a.category) || [];
    list.push(a);
    categoryGroups.set(a.category, list);
  }

  const sortedCategories = Array.from(categoryGroups.entries()).sort((a, b) => b[1].length - a[1].length);

  let globalIndex = 0;
  for (const [catId, catArticles] of sortedCategories) {
    const catMeta = CATEGORY_META[catId];
    report += `## ${catMeta.emoji} ${catMeta.label}\n\n`;

    for (const a of catArticles) {
      globalIndex++;
      const scoreTotal = a.scoreBreakdown.relevance + a.scoreBreakdown.quality + a.scoreBreakdown.timeliness;

      report += `### ${globalIndex}. ${a.title}\n\n`;
      report += `[Link](${a.link}) — **${a.sourceName}** · ${humanizeTime(a.pubDate)} · ⭐ ${scoreTotal}/30\n\n`;
      report += `> ${a.summary}\n\n`;
      if (a.keywords.length > 0) {
        report += `🏷️ ${a.keywords.join(", ")}\n\n`;
      }
      report += `---\n\n`;
    }
  }

  report += `*Generated on ${stats.dateStr} | Scanned ${stats.successFeeds} sources → Found ${stats.totalArticles} articles → Selected ${articles.length} articles*\n`;
  report += `*Based on [Hacker News Popularity Contest 2025](https://refactoringenglish.com/tools/hn-popularity/) RSS feeds list, curated by [Andrej Karpathy](https://x.com/karpathy).*\n`;
  report += `*Created by "Understand AI".*\n`;

  return report;
}

/** A minimal report for days where dedup leaves no new articles to score. */
export function generateEmptyReport(
  dateStr: string,
  stats: { totalFeeds: number; successFeeds: number; totalArticles: number; filteredArticles: number },
): string {
  const frontmatter = [
    "---",
    `title: AI Blog Daily Digest ${dateStr}`,
    `date: ${dateStr}`,
    'summary: "No new articles today — everything in the window was already covered."',
    "---",
    "",
    "",
  ].join("\n");

  let report = frontmatter;
  report += `# 📰 AI Blog Daily Digest — ${dateStr}\n\n`;
  report += `> No new articles today. Everything within the lookback window had already been covered in earlier digests.\n\n`;
  report += `## 📊 Data Overview\n\n`;
  report += `| Scanned | Articles | New |\n`;
  report += `|:---:|:---:|:---:|\n`;
  report += `| ${stats.successFeeds}/${stats.totalFeeds} | ${stats.totalArticles} → ${stats.filteredArticles} | **0** |\n\n`;
  report += `*Generated on ${dateStr}. Based on [Hacker News Popularity Contest 2025](https://refactoringenglish.com/tools/hn-popularity/) RSS feeds, curated by [Andrej Karpathy](https://x.com/karpathy).*\n`;
  return report;
}
