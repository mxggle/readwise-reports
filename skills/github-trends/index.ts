import type { SkillContext, SkillResult } from "../_sdk/index.js";

interface TrendItem {
  repo: string;
  description: string;
  language: string;
  stars: number;
  forks: number;
  url: string;
}

const SEARCH_API = "https://api.github.com/search/repositories";

interface GitHubRepo {
  full_name: string;
  description: string | null;
  language: string | null;
  stargazers_count: number;
  forks_count: number;
  html_url: string;
}

interface SearchResponse {
  items?: GitHubRepo[];
}

/**
 * Approximate "trending" via the official GitHub Search API: repositories
 * created within the lookback window, ranked by total stars. Unlike the
 * unofficial scraping APIs this endpoint is maintained by GitHub and stable.
 * Works unauthenticated (60 req/h); set GITHUB_TOKEN to raise the limit.
 */
async function fetchTrends(lookbackHours: number, perPage: number): Promise<TrendItem[]> {
  const days = Math.max(1, Math.round(lookbackHours / 24));
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  const query = `created:>${since}`;
  const url = `${SEARCH_API}?q=${encodeURIComponent(query)}&sort=stars&order=desc&per_page=${perPage}`;

  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "readwise-reports",
  };
  const token = process.env.GITHUB_TOKEN;
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetch(url, { headers });
  if (!response.ok) {
    throw new Error(`GitHub search API returned ${response.status}`);
  }
  const data: SearchResponse = await response.json();
  return (data.items || []).map((r) => ({
    repo: r.full_name,
    description: r.description ?? "",
    language: r.language ?? "",
    stars: r.stargazers_count,
    forks: r.forks_count,
    url: r.html_url,
  }));
}

export default async function run(ctx: SkillContext): Promise<SkillResult> {
  ctx.log.info("Starting GitHub Trends skill");

  const maxItems = ctx.config?.digest?.maxItems ?? 10;
  const lookbackHours = ctx.config?.schedule?.lookbackHours ?? 24;

  let items: TrendItem[];
  try {
    items = await fetchTrends(lookbackHours, maxItems);
  } catch (err: any) {
    ctx.log.warn("Failed to fetch trends, returning empty report", err.message);
    items = [];
  }

  if (items.length === 0) {
    ctx.log.info("No trending items found");
    return { itemsProcessed: 0, itemsSkipped: 0 };
  }

  const selected = items.slice(0, maxItems);

  // Build markdown report
  const lines: string[] = [];
  lines.push(`# 📈 GitHub 趋势项目 (${ctx.date})`);
  lines.push("");
  lines.push("过去24小时GitHub上最热门的开源项目：");
  lines.push("");

  for (const item of selected) {
    const langBadge = item.language ? ` \`${item.language}\`` : "";
    lines.push(`## [${item.repo}](${item.url})${langBadge}`);
    lines.push("");
    lines.push(item.description || "暂无描述");
    lines.push("");
    lines.push(`⭐ ${item.stars.toLocaleString()} | 🍴 ${item.forks.toLocaleString()}`);
    lines.push("");
    lines.push("---");
    lines.push("");
  }

  lines.push("_数据来源: GitHub Search API（按 star 排序的近期新项目）_");

  const markdown = lines.join("\n");

  if (ctx.dryRun) {
    ctx.log.info("Dry run - would write report");
    return { itemsProcessed: selected.length, itemsSkipped: 0 };
  }

  const outputPath = await ctx.writer.writeReport(markdown);
  ctx.log.info(`Report written to ${outputPath}`);

  return { itemsProcessed: selected.length, itemsSkipped: 0 };
}
