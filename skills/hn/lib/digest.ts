import type { AIClient, DedupItem, Logger, SkillStore } from "../../_sdk/index.js";
import { fetchAllFeeds, RSS_FEEDS } from "./feeds.js";
import { generateHighlights, scoreArticlesWithAI, summarizeArticles } from "./scoring.js";
import { generateDigestReport, generateEmptyReport } from "./render.js";
import { computeAiStatus, toDedupable } from "./types.js";
import type { AiStatus, CategoryId, DedupableArticle, ScoredArticle } from "./types.js";

// Re-exported so callers (and tests) have a single import surface for the skill.
export { computeAiStatus } from "./types.js";
export type { AiStatus } from "./types.js";

export interface RunDigestOpts {
  ai: AIClient;
  log: Logger;
  lookbackHours: number;
  maxItems: number;
  date: string;
  /** When provided, cross-day-seen articles are filtered out before AI scoring. */
  store?: SkillStore;
}

export interface RunDigestResult {
  markdown: string;
  stats: {
    totalFeeds: number;
    successFeeds: number;
    totalArticles: number;
    filteredArticles: number;
    selectedCount: number;
    /** Articles dropped because they were already processed on an earlier day. */
    skippedCount: number;
    aiStatus: AiStatus;
  };
  topArticles: Array<{ title: string; sourceName: string; link: string; category: string }>;
  /** Fresh dedup records to persist (caller marks them processed after writing the report). */
  freshItems: DedupItem[];
}

export async function runDigest(opts: RunDigestOpts): Promise<RunDigestResult> {
  const { ai, log, store, lookbackHours, maxItems, date } = opts;

  log.info(`=== AI Daily Digest === (range ${lookbackHours}h, top ${maxItems})`);

  log.info(`Step 1/5: Fetching ${RSS_FEEDS.length} RSS feeds...`);
  const allArticles = await fetchAllFeeds(RSS_FEEDS, log);

  if (allArticles.length === 0) {
    throw new Error("No articles fetched from any feed. Check network connection.");
  }

  log.info(`Step 2/5: Filtering by time range (${lookbackHours} hours)...`);
  const cutoffTime = new Date(Date.now() - lookbackHours * 60 * 60 * 1000);
  const recentArticles = allArticles.filter((a) => a.pubDate.getTime() > cutoffTime.getTime());

  log.info(`Found ${recentArticles.length} articles within last ${lookbackHours} hours`);

  if (recentArticles.length === 0) {
    throw new Error(`No articles found within the last ${lookbackHours} hours.`);
  }

  // Cross-day dedup: drop articles already processed on an earlier day so we
  // never re-score them. The lookback window (e.g. 48h) overlaps day to day, so
  // without this each article would be re-scored and re-summarized on every run.
  // Same-day re-runs keep their articles (the store treats today's report date as
  // fresh), so re-running reproduces the report.
  const successfulSources = new Set(allArticles.map((a) => a.sourceName));
  let fresh: DedupableArticle[] = [];
  let articlesToScore = recentArticles;
  let skippedCount = 0;
  if (store) {
    const filtered = await store.filterUnprocessed(recentArticles.map(toDedupable));
    fresh = filtered.fresh;
    articlesToScore = fresh.map((d) => d.article);
    skippedCount = filtered.skipped.length;
    log.info(`Dedup: ${fresh.length} new, ${filtered.skipped.length} already processed (cross-day).`);
  }

  if (articlesToScore.length === 0) {
    log.info("No new articles after dedup — emitting an empty digest.");
    return {
      markdown: generateEmptyReport(date, {
        totalFeeds: RSS_FEEDS.length,
        successFeeds: successfulSources.size,
        totalArticles: allArticles.length,
        filteredArticles: recentArticles.length,
      }),
      stats: {
        totalFeeds: RSS_FEEDS.length,
        successFeeds: successfulSources.size,
        totalArticles: allArticles.length,
        filteredArticles: recentArticles.length,
        selectedCount: 0,
        skippedCount,
        aiStatus: "ok",
      },
      topArticles: [],
      freshItems: [],
    };
  }

  log.info(`Step 3/5: AI scoring ${articlesToScore.length} articles...`);
  const scoring = await scoreArticlesWithAI(articlesToScore, ai, log);
  const scores = scoring.scores;
  const aiStatus = computeAiStatus(scoring.failedBatches, scoring.totalBatches);
  if (aiStatus !== "ok") {
    log.warn(`AI scoring degraded: ${scoring.failedBatches}/${scoring.totalBatches} batches failed (status: ${aiStatus})`);
  }

  const scoredArticles = articlesToScore.map((article, index) => {
    const score = scores.get(index) || { relevance: 5, quality: 5, timeliness: 5, category: "other" as CategoryId, keywords: [] };
    return {
      ...article,
      totalScore: score.relevance + score.quality + score.timeliness,
      breakdown: score,
    };
  });

  scoredArticles.sort((a, b) => b.totalScore - a.totalScore);
  const topArticles = scoredArticles.slice(0, maxItems);

  log.info(
    `Top ${maxItems} articles selected (score range: ${topArticles[topArticles.length - 1]?.totalScore || 0} - ${topArticles[0]?.totalScore || 0})`,
  );

  log.info(`Step 4/5: Generating AI summaries...`);
  const indexedTopArticles = topArticles.map((a, i) => ({ ...a, index: i }));
  const summaries = await summarizeArticles(indexedTopArticles, ai, log);

  const finalArticles: ScoredArticle[] = topArticles.map((a, i) => {
    const sm = summaries.get(i) || { summary: a.description.slice(0, 200), reason: "" };
    return {
      title: a.title,
      link: a.link,
      pubDate: a.pubDate,
      description: a.description,
      sourceName: a.sourceName,
      sourceUrl: a.sourceUrl,
      score: a.totalScore,
      scoreBreakdown: {
        relevance: a.breakdown.relevance,
        quality: a.breakdown.quality,
        timeliness: a.breakdown.timeliness,
      },
      category: a.breakdown.category,
      keywords: a.breakdown.keywords,
      summary: sm.summary,
      reason: sm.reason,
    };
  });

  log.info(`Step 5/5: Generating today's highlights...`);
  const highlights = await generateHighlights(finalArticles, ai, log);

  const markdown = generateDigestReport(finalArticles, highlights, {
    totalFeeds: RSS_FEEDS.length,
    successFeeds: successfulSources.size,
    totalArticles: allArticles.length,
    filteredArticles: recentArticles.length,
    hours: lookbackHours,
    dateStr: date,
    aiStatus,
  });

  // Persist only the articles that actually made the report. Lower-ranked items
  // that were fetched but not selected are left unmarked so they get another
  // chance on the next run (they naturally age out of the lookback window).
  const selectedLinks = new Set(finalArticles.map((a) => a.link));
  const freshItems = fresh.filter((d) => selectedLinks.has(d.article.link));

  log.info(
    `Done: ${successfulSources.size} sources → ${allArticles.length} articles → ${recentArticles.length} recent → ${articlesToScore.length} new → ${finalArticles.length} selected`,
  );

  return {
    markdown,
    stats: {
      totalFeeds: RSS_FEEDS.length,
      successFeeds: successfulSources.size,
      totalArticles: allArticles.length,
      filteredArticles: recentArticles.length,
      selectedCount: finalArticles.length,
      skippedCount,
      aiStatus,
    },
    topArticles: finalArticles.slice(0, 5).map((a) => ({
      title: a.title,
      sourceName: a.sourceName,
      link: a.link,
      category: a.category,
    })),
    freshItems,
  };
}
