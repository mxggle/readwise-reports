import type { AIClient, Logger } from "../../_sdk/index.js";
import type { Article, CategoryId, ScoredArticle } from "./types.js";

const GEMINI_BATCH_SIZE = 10;
const MAX_CONCURRENT_GEMINI = 2;

const VALID_CATEGORIES = new Set<string>(["ai-ml", "security", "engineering", "tools", "opinion", "other"]);

interface GeminiScoringResult {
  results: Array<{
    index: number;
    relevance: number;
    quality: number;
    timeliness: number;
    category: string;
    keywords: string[];
  }>;
}

interface GeminiSummaryResult {
  results: Array<{
    index: number;
    summary: string;
    reason: string;
  }>;
}

export interface ScoringOutcome {
  scores: Map<number, { relevance: number; quality: number; timeliness: number; category: CategoryId; keywords: string[] }>;
  totalBatches: number;
  failedBatches: number;
}

function parseJsonResponse<T>(text: string): T {
  let jsonText = text.trim();
  if (jsonText.startsWith("```")) {
    jsonText = jsonText.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
  }
  return JSON.parse(jsonText) as T;
}

/** Split a list into fixed-size batches. */
function batched<T>(items: T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    batches.push(items.slice(i, i + size));
  }
  return batches;
}

// ============================================================================
// AI Scoring
// ============================================================================

function buildScoringPrompt(articles: Array<{ index: number; title: string; description: string; sourceName: string }>): string {
  const articlesList = articles
    .map((a) => `Index ${a.index}: [${a.sourceName}] ${a.title}\n${a.description.slice(0, 300)}`)
    .join("\n\n---\n\n");

  return `You are a technical content curator, screening articles for a daily digest aimed at tech enthusiasts.

Please score the following articles on three dimensions (1-10 integer, 10 is highest), assign a category label, and extract 2-4 keywords for each article.

## Scoring Dimensions

### 1. Relevance (relevance) - Value to tech/programming/AI/Internet professionals
- 10: Major events/breakthroughs every tech person should know
- 7-9: Valuable for most tech professionals
- 4-6: Valuable for specific technical fields
- 1-3: Little relevance to the tech industry

### 2. Quality (quality) - Depth and writing quality of the article itself
- 10: Deep analysis, original insights, rich references
- 7-9: Shows depth, unique perspective
- 4-6: Accurate information, clear expression
- 1-3: Superficial or pure repost/paraphrase

### 3. Timeliness (timeliness) - Whether it's worth reading right now
- 10: Major ongoing events/newly released important tools
- 7-9: Related to recent hot topics
- 4-6: Evergreen content, not outdated
- 1-3: Outdated or no timeliness value

## Category Labels (Must choose one of the following)
- ai-ml: AI, Machine Learning, LLM, Deep Learning related
- security: Security, Privacy, Vulnerabilities, Encryption related
- engineering: Software Engineering, Architecture, Programming Languages, System Design
- tools: Dev Tools, Open Source projects, newly released libraries/frameworks
- opinion: Industry views, personal reflections, career development, cultural reviews
- other: Anything that doesn't fit the above

## Keyword Extraction
Extract 2-4 keywords that best represent the article's theme (use English, keep it brief, e.g., "Rust", "LLM", "database", "performance")

## Articles to be Scored

${articlesList}

Please return strictly in JSON format, without including markdown code blocks or other text:
{
  "results": [
    {
      "index": 0,
      "relevance": 8,
      "quality": 7,
      "timeliness": 6,
      "category": "ai-ml",
      "keywords": ["LLM", "inference"]
    }
  ]
}`;
}

export async function scoreArticlesWithAI(articles: Article[], ai: AIClient, log: Logger): Promise<ScoringOutcome> {
  const allScores: ScoringOutcome["scores"] = new Map();
  let failedBatches = 0;

  const indexed = articles.map((article, index) => ({
    index,
    title: article.title,
    description: article.description,
    sourceName: article.sourceName,
  }));

  const batches = batched(indexed, GEMINI_BATCH_SIZE);

  log.info(`AI scoring: ${articles.length} articles in ${batches.length} batches`);

  for (let i = 0; i < batches.length; i += MAX_CONCURRENT_GEMINI) {
    const batchGroup = batches.slice(i, i + MAX_CONCURRENT_GEMINI);
    const promises = batchGroup.map(async (batch) => {
      try {
        const prompt = buildScoringPrompt(batch);
        const responseText = await ai.complete(prompt, { temperature: 0.3 });
        const parsed = parseJsonResponse<GeminiScoringResult>(responseText);

        if (parsed.results && Array.isArray(parsed.results)) {
          for (const result of parsed.results) {
            const clamp = (v: number) => Math.min(10, Math.max(1, Math.round(v)));
            const cat = (VALID_CATEGORIES.has(result.category) ? result.category : "other") as CategoryId;
            allScores.set(result.index, {
              relevance: clamp(result.relevance),
              quality: clamp(result.quality),
              timeliness: clamp(result.timeliness),
              category: cat,
              keywords: Array.isArray(result.keywords) ? result.keywords.slice(0, 4) : [],
            });
          }
        }
      } catch (error) {
        failedBatches++;
        log.warn(`Scoring batch failed: ${error instanceof Error ? error.message : String(error)}`);
        for (const item of batch) {
          allScores.set(item.index, { relevance: 5, quality: 5, timeliness: 5, category: "other", keywords: [] });
        }
      }
    });

    await Promise.all(promises);
    log.info(`Scoring progress: ${Math.min(i + MAX_CONCURRENT_GEMINI, batches.length)}/${batches.length} batches`);
  }

  return { scores: allScores, totalBatches: batches.length, failedBatches };
}

// ============================================================================
// AI Summarization
// ============================================================================

function buildSummaryPrompt(
  articles: Array<{ index: number; title: string; description: string; sourceName: string; link: string }>,
): string {
  const articlesList = articles
    .map((a) => `Index ${a.index}: [${a.sourceName}] ${a.title}\nURL: ${a.link}\n${a.description.slice(0, 800)}`)
    .join("\n\n---\n\n");

  return `You are a technical content summarization expert. For each of the following articles, please provide:

1. **Summary** (summary): A structured summary of 4-6 sentences that allows readers to understand the core content without clicking the original link. Include:
   - The core problem or topic discussed (1 sentence)
   - Key arguments, technical solutions, or findings (2-3 sentences)
   - Conclusion or core point of the author (1 sentence)
2. **Recommendation Reason** (reason): A single sentence explaining "why it's worth reading" (distinguish from the summary: the summary says "what it is", the reason says "why it matters").

Summary Requirements:
- Get straight to the point; do not start with "This article discusses..." or "This post introduces..."
- Include specific technical terms, data, solution names, or viewpoints
- Retain key numbers and metrics (e.g., performance improvement percentages, user counts, version numbers)
- If the article involves comparisons or selections, point out the comparison objects and conclusions
- Goal: A reader should be able to spend 30 seconds reading the summary and decide whether it's worth spending 10 minutes reading the full article.

## Articles to Summarize

${articlesList}

Please return strictly in JSON format:
{
  "results": [
    {
      "index": 0,
      "summary": "Summary content...",
      "reason": "Recommendation reason..."
    }
  ]
}`;
}

export async function summarizeArticles(
  articles: Array<Article & { index: number }>,
  ai: AIClient,
  log: Logger,
): Promise<Map<number, { summary: string; reason: string }>> {
  const summaries = new Map<number, { summary: string; reason: string }>();

  const indexed = articles.map((a) => ({
    index: a.index,
    title: a.title,
    description: a.description,
    sourceName: a.sourceName,
    link: a.link,
  }));

  const batches = batched(indexed, GEMINI_BATCH_SIZE);

  log.info(`Generating summaries for ${articles.length} articles in ${batches.length} batches`);

  for (let i = 0; i < batches.length; i += MAX_CONCURRENT_GEMINI) {
    const batchGroup = batches.slice(i, i + MAX_CONCURRENT_GEMINI);
    const promises = batchGroup.map(async (batch) => {
      try {
        const prompt = buildSummaryPrompt(batch);
        const responseText = await ai.complete(prompt, { temperature: 0.3 });
        const parsed = parseJsonResponse<GeminiSummaryResult>(responseText);

        if (parsed.results && Array.isArray(parsed.results)) {
          for (const result of parsed.results) {
            summaries.set(result.index, {
              summary: result.summary || "",
              reason: result.reason || "",
            });
          }
        }
      } catch (error) {
        log.warn(`Summary batch failed: ${error instanceof Error ? error.message : String(error)}`);
        for (const item of batch) {
          summaries.set(item.index, { summary: item.description.slice(0, 200), reason: "" });
        }
      }
    });

    await Promise.all(promises);
    log.info(`Summary progress: ${Math.min(i + MAX_CONCURRENT_GEMINI, batches.length)}/${batches.length} batches`);
  }

  return summaries;
}

// ============================================================================
// AI Highlights (Today's Trends)
// ============================================================================

export async function generateHighlights(articles: ScoredArticle[], ai: AIClient, log: Logger): Promise<string> {
  const articleList = articles
    .slice(0, 10)
    .map((a, i) => `${i + 1}. [${a.category}] ${a.title} — ${a.summary.slice(0, 100)}`)
    .join("\n");

  const prompt = `Based on the following list of today's top technical articles, write a summary of 3-5 sentences for "Today's Highlights".
Requirements:
- Extract 2-3 main trends or topics in the tech circle today.
- Do not list each article; provide a macro-level summary.
- The style should be concise and powerful, like a news lead.
Write in English.

articleList:
${articleList}

Return only the plain text summary, no JSON, no markdown formatting.`;

  try {
    const text = await ai.complete(prompt, { temperature: 0.3 });
    return text.trim();
  } catch (error) {
    log.warn(`Highlights generation failed: ${error instanceof Error ? error.message : String(error)}`);
    return "";
  }
}
