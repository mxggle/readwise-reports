import type { AIClient } from "../../_sdk/index.js";

// ============================================================================
// Constants
// ============================================================================

const FEED_FETCH_TIMEOUT_MS = 15_000;
const FEED_CONCURRENCY = 10;
const GEMINI_BATCH_SIZE = 10;
const MAX_CONCURRENT_GEMINI = 2;

// 90 RSS feeds from Hacker News Popularity Contest 2025 (curated by Karpathy)
const RSS_FEEDS: Array<{ name: string; xmlUrl: string; htmlUrl: string }> = [
  { name: "simonwillison.net", xmlUrl: "https://simonwillison.net/atom/everything/", htmlUrl: "https://simonwillison.net" },
  { name: "jeffgeerling.com", xmlUrl: "https://www.jeffgeerling.com/blog.xml", htmlUrl: "https://jeffgeerling.com" },
  { name: "seangoedecke.com", xmlUrl: "https://www.seangoedecke.com/rss.xml", htmlUrl: "https://seangoedecke.com" },
  { name: "krebsonsecurity.com", xmlUrl: "https://krebsonsecurity.com/feed/", htmlUrl: "https://krebsonsecurity.com" },
  { name: "daringfireball.net", xmlUrl: "https://daringfireball.net/feeds/main", htmlUrl: "https://daringfireball.net" },
  { name: "ericmigi.com", xmlUrl: "https://ericmigi.com/rss.xml", htmlUrl: "https://ericmigi.com" },
  { name: "antirez.com", xmlUrl: "http://antirez.com/rss", htmlUrl: "http://antirez.com" },
  { name: "idiallo.com", xmlUrl: "https://idiallo.com/feed.rss", htmlUrl: "https://idiallo.com" },
  { name: "maurycyz.com", xmlUrl: "https://maurycyz.com/index.xml", htmlUrl: "https://maurycyz.com" },
  { name: "pluralistic.net", xmlUrl: "https://pluralistic.net/feed/", htmlUrl: "https://pluralistic.net" },
  { name: "shkspr.mobi", xmlUrl: "https://shkspr.mobi/blog/feed/", htmlUrl: "https://shkspr.mobi" },
  { name: "lcamtuf.substack.com", xmlUrl: "https://lcamtuf.substack.com/feed", htmlUrl: "https://lcamtuf.substack.com" },
  { name: "mitchellh.com", xmlUrl: "https://mitchellh.com/feed.xml", htmlUrl: "https://mitchellh.com" },
  { name: "dynomight.net", xmlUrl: "https://dynomight.net/feed.xml", htmlUrl: "https://dynomight.net" },
  { name: "utcc.utoronto.ca/~cks", xmlUrl: "https://utcc.utoronto.ca/~cks/space/blog/?atom", htmlUrl: "https://utcc.utoronto.ca/~cks" },
  { name: "xeiaso.net", xmlUrl: "https://xeiaso.net/blog.rss", htmlUrl: "https://xeiaso.net" },
  { name: "devblogs.microsoft.com/oldnewthing", xmlUrl: "https://devblogs.microsoft.com/oldnewthing/feed", htmlUrl: "https://devblogs.microsoft.com/oldnewthing" },
  { name: "righto.com", xmlUrl: "https://www.righto.com/feeds/posts/default", htmlUrl: "https://righto.com" },
  { name: "lucumr.pocoo.org", xmlUrl: "https://lucumr.pocoo.org/feed.atom", htmlUrl: "https://lucumr.pocoo.org" },
  { name: "skyfall.dev", xmlUrl: "https://skyfall.dev/rss.xml", htmlUrl: "https://skyfall.dev" },
  { name: "garymarcus.substack.com", xmlUrl: "https://garymarcus.substack.com/feed", htmlUrl: "https://garymarcus.substack.com" },
  { name: "rachelbythebay.com", xmlUrl: "https://rachelbythebay.com/w/atom.xml", htmlUrl: "https://rachelbythebay.com" },
  { name: "overreacted.io", xmlUrl: "https://overreacted.io/rss.xml", htmlUrl: "https://overreacted.io" },
  { name: "timsh.org", xmlUrl: "https://timsh.org/rss/", htmlUrl: "https://timsh.org" },
  { name: "johndcook.com", xmlUrl: "https://www.johndcook.com/blog/feed/", htmlUrl: "https://johndcook.com" },
  { name: "gilesthomas.com", xmlUrl: "https://gilesthomas.com/feed/rss.xml", htmlUrl: "https://gilesthomas.com" },
  { name: "matklad.github.io", xmlUrl: "https://matklad.github.io/feed.xml", htmlUrl: "https://matklad.github.io" },
  { name: "derekthompson.org", xmlUrl: "https://www.theatlantic.com/feed/author/derek-thompson/", htmlUrl: "https://derekthompson.org" },
  { name: "evanhahn.com", xmlUrl: "https://evanhahn.com/feed.xml", htmlUrl: "https://evanhahn.com" },
  { name: "terriblesoftware.org", xmlUrl: "https://terriblesoftware.org/feed/", htmlUrl: "https://terriblesoftware.org" },
  { name: "rakhim.exotext.com", xmlUrl: "https://rakhim.exotext.com/rss.xml", htmlUrl: "https://rakhim.exotext.com" },
  { name: "joanwestenberg.com", xmlUrl: "https://joanwestenberg.com/rss", htmlUrl: "https://joanwestenberg.com" },
  { name: "xania.org", xmlUrl: "https://xania.org/feed", htmlUrl: "https://xania.org" },
  { name: "micahflee.com", xmlUrl: "https://micahflee.com/feed/", htmlUrl: "https://micahflee.com" },
  { name: "nesbitt.io", xmlUrl: "https://nesbitt.io/feed.xml", htmlUrl: "https://nesbitt.io" },
  { name: "construction-physics.com", xmlUrl: "https://www.construction-physics.com/feed", htmlUrl: "https://construction-physics.com" },
  { name: "tedium.co", xmlUrl: "https://feed.tedium.co/", htmlUrl: "https://tedium.co" },
  { name: "susam.net", xmlUrl: "https://susam.net/feed.xml", htmlUrl: "https://susam.net" },
  { name: "entropicthoughts.com", xmlUrl: "https://entropicthoughts.com/feed.xml", htmlUrl: "https://entropicthoughts.com" },
  { name: "buttondown.com/hillelwayne", xmlUrl: "https://buttondown.com/hillelwayne/rss", htmlUrl: "https://buttondown.com/hillelwayne" },
  { name: "dwarkesh.com", xmlUrl: "https://www.dwarkeshpatel.com/feed", htmlUrl: "https://dwarkesh.com" },
  { name: "borretti.me", xmlUrl: "https://borretti.me/feed.xml", htmlUrl: "https://borretti.me" },
  { name: "wheresyoured.at", xmlUrl: "https://www.wheresyoured.at/rss/", htmlUrl: "https://wheresyoured.at" },
  { name: "jayd.ml", xmlUrl: "https://jayd.ml/feed.xml", htmlUrl: "https://jayd.ml" },
  { name: "minimaxir.com", xmlUrl: "https://minimaxir.com/index.xml", htmlUrl: "https://minimaxir.com" },
  { name: "geohot.github.io", xmlUrl: "https://geohot.github.io/blog/feed.xml", htmlUrl: "https://geohot.github.io" },
  { name: "paulgraham.com", xmlUrl: "http://www.aaronsw.com/2002/feeds/pgessays.rss", htmlUrl: "https://paulgraham.com" },
  { name: "filfre.net", xmlUrl: "https://www.filfre.net/feed/", htmlUrl: "https://filfre.net" },
  { name: "blog.jim-nielsen.com", xmlUrl: "https://blog.jim-nielsen.com/feed.xml", htmlUrl: "https://blog.jim-nielsen.com" },
  { name: "dfarq.homeip.net", xmlUrl: "https://dfarq.homeip.net/feed/", htmlUrl: "https://dfarq.homeip.net" },
  { name: "jyn.dev", xmlUrl: "https://jyn.dev/atom.xml", htmlUrl: "https://jyn.dev" },
  { name: "geoffreylitt.com", xmlUrl: "https://www.geoffreylitt.com/feed.xml", htmlUrl: "https://geoffreylitt.com" },
  { name: "downtowndougbrown.com", xmlUrl: "https://www.downtowndougbrown.com/feed/", htmlUrl: "https://downtowndougbrown.com" },
  { name: "brutecat.com", xmlUrl: "https://brutecat.com/rss.xml", htmlUrl: "https://brutecat.com" },
  { name: "eli.thegreenplace.net", xmlUrl: "https://eli.thegreenplace.net/feeds/all.atom.xml", htmlUrl: "https://eli.thegreenplace.net" },
  { name: "abortretry.fail", xmlUrl: "https://www.abortretry.fail/feed", htmlUrl: "https://abortretry.fail" },
  { name: "fabiensanglard.net", xmlUrl: "https://fabiensanglard.net/rss.xml", htmlUrl: "https://fabiensanglard.net" },
  { name: "oldvcr.blogspot.com", xmlUrl: "https://oldvcr.blogspot.com/feeds/posts/default", htmlUrl: "https://oldvcr.blogspot.com" },
  { name: "bogdanthegeek.github.io", xmlUrl: "https://bogdanthegeek.github.io/blog/index.xml", htmlUrl: "https://bogdanthegeek.github.io" },
  { name: "hugotunius.se", xmlUrl: "https://hugotunius.se/feed.xml", htmlUrl: "https://hugotunius.se" },
  { name: "gwern.net", xmlUrl: "https://gwern.substack.com/feed", htmlUrl: "https://gwern.net" },
  { name: "berthub.eu", xmlUrl: "https://berthub.eu/articles/index.xml", htmlUrl: "https://berthub.eu" },
  { name: "chadnauseam.com", xmlUrl: "https://chadnauseam.com/rss.xml", htmlUrl: "https://chadnauseam.com" },
  { name: "simone.org", xmlUrl: "https://simone.org/feed/", htmlUrl: "https://simone.org" },
  { name: "it-notes.dragas.net", xmlUrl: "https://it-notes.dragas.net/feed/", htmlUrl: "https://it-notes.dragas.net" },
  { name: "beej.us", xmlUrl: "https://beej.us/blog/rss.xml", htmlUrl: "https://beej.us" },
  { name: "hey.paris", xmlUrl: "https://hey.paris/index.xml", htmlUrl: "https://hey.paris" },
  { name: "danielwirtz.com", xmlUrl: "https://danielwirtz.com/rss.xml", htmlUrl: "https://danielwirtz.com" },
  { name: "matduggan.com", xmlUrl: "https://matduggan.com/rss/", htmlUrl: "https://matduggan.com" },
  { name: "refactoringenglish.com", xmlUrl: "https://refactoringenglish.com/index.xml", htmlUrl: "https://refactoringenglish.com" },
  { name: "worksonmymachine.substack.com", xmlUrl: "https://worksonmymachine.substack.com/feed", htmlUrl: "https://worksonmymachine.substack.com" },
  { name: "philiplaine.com", xmlUrl: "https://philiplaine.com/index.xml", htmlUrl: "https://philiplaine.com" },
  { name: "steveblank.com", xmlUrl: "https://steveblank.com/feed/", htmlUrl: "https://steveblank.com" },
  { name: "bernsteinbear.com", xmlUrl: "https://bernsteinbear.com/feed.xml", htmlUrl: "https://bernsteinbear.com" },
  { name: "danieldelaney.net", xmlUrl: "https://danieldelaney.net/feed", htmlUrl: "https://danieldelaney.net" },
  { name: "troyhunt.com", xmlUrl: "https://www.troyhunt.com/rss/", htmlUrl: "https://troyhunt.com" },
  { name: "herman.bearblog.dev", xmlUrl: "https://herman.bearblog.dev/feed/", htmlUrl: "https://herman.bearblog.dev" },
  { name: "tomrenner.com", xmlUrl: "https://tomrenner.com/index.xml", htmlUrl: "https://tomrenner.com" },
  { name: "blog.pixelmelt.dev", xmlUrl: "https://blog.pixelmelt.dev/rss/", htmlUrl: "https://blog.pixelmelt.dev" },
  { name: "martinalderson.com", xmlUrl: "https://martinalderson.com/feed.xml", htmlUrl: "https://martinalderson.com" },
  { name: "danielchasehooper.com", xmlUrl: "https://danielchasehooper.com/feed.xml", htmlUrl: "https://danielchasehooper.com" },
  { name: "chiark.greenend.org.uk/~sgtatham", xmlUrl: "https://www.chiark.greenend.org.uk/~sgtatham/quasiblog/feed.xml", htmlUrl: "https://chiark.greenend.org.uk/~sgtatham" },
  { name: "grantslatton.com", xmlUrl: "https://grantslatton.com/rss.xml", htmlUrl: "https://grantslatton.com" },
  { name: "experimental-history.com", xmlUrl: "https://www.experimental-history.com/feed", htmlUrl: "https://experimental-history.com" },
  { name: "anildash.com", xmlUrl: "https://anildash.com/feed.xml", htmlUrl: "https://anildash.com" },
  { name: "aresluna.org", xmlUrl: "https://aresluna.org/main.rss", htmlUrl: "https://aresluna.org" },
  { name: "michael.stapelberg.ch", xmlUrl: "https://michael.stapelberg.ch/feed.xml", htmlUrl: "https://michael.stapelberg.ch" },
  { name: "miguelgrinberg.com", xmlUrl: "https://blog.miguelgrinberg.com/feed", htmlUrl: "https://miguelgrinberg.com" },
  { name: "keygen.sh", xmlUrl: "https://keygen.sh/blog/feed.xml", htmlUrl: "https://keygen.sh" },
  { name: "mjg59.dreamwidth.org", xmlUrl: "https://mjg59.dreamwidth.org/data/rss", htmlUrl: "https://mjg59.dreamwidth.org" },
  { name: "computer.rip", xmlUrl: "https://computer.rip/rss.xml", htmlUrl: "https://computer.rip" },
  { name: "tedunangst.com", xmlUrl: "https://www.tedunangst.com/flak/rss", htmlUrl: "https://tedunangst.com" },
];

// ============================================================================
// Types
// ============================================================================

type CategoryId = 'ai-ml' | 'security' | 'engineering' | 'tools' | 'opinion' | 'other';

const CATEGORY_META: Record<CategoryId, { emoji: string; label: string }> = {
  'ai-ml': { emoji: '🤖', label: 'AI / ML' },
  'security': { emoji: '🔒', label: 'Security' },
  'engineering': { emoji: '⚙️', label: 'Engineering' },
  'tools': { emoji: '🛠', label: 'Tools / Open Source' },
  'opinion': { emoji: '💡', label: 'Opinion / Essays' },
  'other': { emoji: '📝', label: 'Other' },
};

interface Article {
  title: string;
  link: string;
  pubDate: Date;
  description: string;
  sourceName: string;
  sourceUrl: string;
}

interface ScoredArticle extends Article {
  score: number;
  scoreBreakdown: {
    relevance: number;
    quality: number;
    timeliness: number;
  };
  category: CategoryId;
  keywords: string[];
  summary: string;
  reason: string;
}

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

// ============================================================================
// RSS/Atom Parsing
// ============================================================================

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code)))
    .trim();
}

function extractCDATA(text: string): string {
  const cdataMatch = text.match(/<!\[CDATA\[([\s\S]*?)\]\]>/);
  return cdataMatch ? cdataMatch[1] : text;
}

function getTagContent(xml: string, tagName: string): string {
  const patterns = [
    new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)</${tagName}>`, 'i'),
    new RegExp(`<${tagName}[^>]*/>`, 'i'),
  ];

  for (const pattern of patterns) {
    const match = xml.match(pattern);
    if (match?.[1]) {
      return extractCDATA(match[1]).trim();
    }
  }
  return '';
}

function getAttrValue(xml: string, tagName: string, attrName: string): string {
  const pattern = new RegExp(`<${tagName}[^>]*\\s${attrName}=["']([^"']*)["'][^>]*/?>`, 'i');
  const match = xml.match(pattern);
  return match?.[1] || '';
}

function parseDate(dateStr: string): Date | null {
  if (!dateStr) return null;

  const d = new Date(dateStr);
  if (!isNaN(d.getTime())) return d;

  const rfc822 = dateStr.match(/(\d{1,2})\s+(\w{3})\s+(\d{4})\s+(\d{2}):(\d{2}):(\d{2})/);
  if (rfc822) {
    const parsed = new Date(dateStr);
    if (!isNaN(parsed.getTime())) return parsed;
  }

  return null;
}

function parseRSSItems(xml: string): Array<{ title: string; link: string; pubDate: string; description: string }> {
  const items: Array<{ title: string; link: string; pubDate: string; description: string }> = [];

  const isAtom = xml.includes('<feed') && xml.includes('xmlns="http://www.w3.org/2005/Atom"') || xml.includes('<feed ');

  if (isAtom) {
    const entryPattern = /<entry[\s>]([\s\S]*?)<\/entry>/gi;
    let entryMatch;
    while ((entryMatch = entryPattern.exec(xml)) !== null) {
      const entryXml = entryMatch[1];
      const title = stripHtml(getTagContent(entryXml, 'title'));

      let link = getAttrValue(entryXml, 'link[^>]*rel="alternate"', 'href');
      if (!link) {
        link = getAttrValue(entryXml, 'link', 'href');
      }

      const pubDate = getTagContent(entryXml, 'published')
        || getTagContent(entryXml, 'updated');

      const description = stripHtml(
        getTagContent(entryXml, 'summary')
        || getTagContent(entryXml, 'content')
      );

      if (title || link) {
        items.push({ title, link, pubDate, description: description.slice(0, 500) });
      }
    }
  } else {
    const itemPattern = /<item[\s>]([\s\S]*?)<\/item>/gi;
    let itemMatch;
    while ((itemMatch = itemPattern.exec(xml)) !== null) {
      const itemXml = itemMatch[1];
      const title = stripHtml(getTagContent(itemXml, 'title'));
      const link = getTagContent(itemXml, 'link') || getTagContent(itemXml, 'guid');
      const pubDate = getTagContent(itemXml, 'pubDate')
        || getTagContent(itemXml, 'dc:date')
        || getTagContent(itemXml, 'date');
      const description = stripHtml(
        getTagContent(itemXml, 'description')
        || getTagContent(itemXml, 'content:encoded')
      );

      if (title || link) {
        items.push({ title, link, pubDate, description: description.slice(0, 500) });
      }
    }
  }

  return items;
}

// ============================================================================
// Feed Fetching
// ============================================================================

async function fetchFeed(feed: { name: string; xmlUrl: string; htmlUrl: string }): Promise<Article[]> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FEED_FETCH_TIMEOUT_MS);

    const response = await fetch(feed.xmlUrl, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'AI-Daily-Digest/1.0 (RSS Reader)',
        'Accept': 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*',
      },
    });

    clearTimeout(timeout);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const xml = await response.text();
    const items = parseRSSItems(xml);

    return items.map(item => ({
      title: item.title,
      link: item.link,
      pubDate: parseDate(item.pubDate) || new Date(0),
      description: item.description,
      sourceName: feed.name,
      sourceUrl: feed.htmlUrl,
    }));
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (!msg.includes('abort')) {
      console.warn(`[digest] ✗ ${feed.name}: ${msg}`);
    } else {
      console.warn(`[digest] ✗ ${feed.name}: timeout`);
    }
    return [];
  }
}

async function fetchAllFeeds(feeds: typeof RSS_FEEDS): Promise<Article[]> {
  const allArticles: Article[] = [];
  let successCount = 0;
  let failCount = 0;

  for (let i = 0; i < feeds.length; i += FEED_CONCURRENCY) {
    const batch = feeds.slice(i, i + FEED_CONCURRENCY);
    const results = await Promise.allSettled(batch.map(fetchFeed));

    for (const result of results) {
      if (result.status === 'fulfilled' && result.value.length > 0) {
        allArticles.push(...result.value);
        successCount++;
      } else {
        failCount++;
      }
    }

    const progress = Math.min(i + FEED_CONCURRENCY, feeds.length);
    console.log(`[digest] Progress: ${progress}/${feeds.length} feeds processed (${successCount} ok, ${failCount} failed)`);
  }

  console.log(`[digest] Fetched ${allArticles.length} articles from ${successCount} feeds (${failCount} failed)`);
  return allArticles;
}

function parseJsonResponse<T>(text: string): T {
  let jsonText = text.trim();
  if (jsonText.startsWith('```')) {
    jsonText = jsonText.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
  }
  return JSON.parse(jsonText) as T;
}

// ============================================================================
// AI Scoring
// ============================================================================

function buildScoringPrompt(articles: Array<{ index: number; title: string; description: string; sourceName: string }>): string {
  const articlesList = articles.map(a =>
    `Index ${a.index}: [${a.sourceName}] ${a.title}\n${a.description.slice(0, 300)}`
  ).join('\n\n---\n\n');

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
      "timeliness": 9,
      "category": "engineering",
      "keywords": ["Rust", "compiler", "performance"]
    }
  ]
}`;
}

async function scoreArticlesWithAI(
  articles: Article[],
  ai: AIClient,
): Promise<Map<number, { relevance: number; quality: number; timeliness: number; category: CategoryId; keywords: string[] }>> {
  const allScores = new Map<number, { relevance: number; quality: number; timeliness: number; category: CategoryId; keywords: string[] }>();

  const indexed = articles.map((article, index) => ({
    index,
    title: article.title,
    description: article.description,
    sourceName: article.sourceName,
  }));

  const batches: typeof indexed[] = [];
  for (let i = 0; i < indexed.length; i += GEMINI_BATCH_SIZE) {
    batches.push(indexed.slice(i, i + GEMINI_BATCH_SIZE));
  }

  console.log(`[digest] AI scoring: ${articles.length} articles in ${batches.length} batches`);

  const validCategories = new Set<string>(['ai-ml', 'security', 'engineering', 'tools', 'opinion', 'other']);

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
            const cat = (validCategories.has(result.category) ? result.category : 'other') as CategoryId;
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
        console.warn(`[digest] Scoring batch failed: ${error instanceof Error ? error.message : String(error)}`);
        for (const item of batch) {
          allScores.set(item.index, { relevance: 5, quality: 5, timeliness: 5, category: 'other', keywords: [] });
        }
      }
    });

    await Promise.all(promises);
    console.log(`[digest] Scoring progress: ${Math.min(i + MAX_CONCURRENT_GEMINI, batches.length)}/${batches.length} batches`);
  }

  return allScores;
}

// ============================================================================
// AI Summarization
// ============================================================================

function buildSummaryPrompt(
  articles: Array<{ index: number; title: string; description: string; sourceName: string; link: string }>
): string {
  const articlesList = articles.map(a =>
    `Index ${a.index}: [${a.sourceName}] ${a.title}\nURL: ${a.link}\n${a.description.slice(0, 800)}`
  ).join('\n\n---\n\n');

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

async function summarizeArticles(
  articles: Array<Article & { index: number }>,
  ai: AIClient,
): Promise<Map<number, { summary: string; reason: string }>> {
  const summaries = new Map<number, { summary: string; reason: string }>();

  const indexed = articles.map(a => ({
    index: a.index,
    title: a.title,
    description: a.description,
    sourceName: a.sourceName,
    link: a.link,
  }));

  const batches: typeof indexed[] = [];
  for (let i = 0; i < indexed.length; i += GEMINI_BATCH_SIZE) {
    batches.push(indexed.slice(i, i + GEMINI_BATCH_SIZE));
  }

  console.log(`[digest] Generating summaries for ${articles.length} articles in ${batches.length} batches`);

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
              summary: result.summary || '',
              reason: result.reason || '',
            });
          }
        }
      } catch (error) {
        console.warn(`[digest] Summary batch failed: ${error instanceof Error ? error.message : String(error)}`);
        for (const item of batch) {
          summaries.set(item.index, { summary: item.description.slice(0, 200), reason: '' });
        }
      }
    });

    await Promise.all(promises);
    console.log(`[digest] Summary progress: ${Math.min(i + MAX_CONCURRENT_GEMINI, batches.length)}/${batches.length} batches`);
  }

  return summaries;
}

// ============================================================================
// AI Highlights (Today's Trends)
// ============================================================================

async function generateHighlights(
  articles: ScoredArticle[],
  ai: AIClient,
): Promise<string> {
  const articleList = articles.slice(0, 10).map((a, i) =>
    `${i + 1}. [${a.category}] ${a.title} — ${a.summary.slice(0, 100)}`
  ).join('\n');

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
    console.warn(`[digest] Highlights generation failed: ${error instanceof Error ? error.message : String(error)}`);
    return '';
  }
}

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

function generateKeywordBarChart(articles: ScoredArticle[]): string {
  const kwCount = new Map<string, number>();
  for (const a of articles) {
    for (const kw of a.keywords) {
      const normalized = kw.toLowerCase();
      kwCount.set(normalized, (kwCount.get(normalized) || 0) + 1);
    }
  }

  const sorted = Array.from(kwCount.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12);

  if (sorted.length === 0) return '';

  const labels = sorted.map(([k]) => `"${k}"`).join(', ');
  const values = sorted.map(([, v]) => v).join(', ');
  const maxVal = sorted[0][1];

  let chart = '```mermaid\n';
  chart += `xychart-beta horizontal\n`;
  chart += `    title "Frequency Keywords"\n`;
  chart += `    x-axis [${labels}]\n`;
  chart += `    y-axis "Occurrences" 0 --> ${maxVal + 2}\n`;
  chart += `    bar [${values}]\n`;
  chart += '```\n';

  return chart;
}

function generateCategoryPieChart(articles: ScoredArticle[]): string {
  const catCount = new Map<CategoryId, number>();
  for (const a of articles) {
    catCount.set(a.category, (catCount.get(a.category) || 0) + 1);
  }

  if (catCount.size === 0) return '';

  const sorted = Array.from(catCount.entries()).sort((a, b) => b[1] - a[1]);

  let chart = '```mermaid\n';
  chart += `pie showData\n`;
  chart += `    title "Article Category Distribution"\n`;
  for (const [cat, count] of sorted) {
    const meta = CATEGORY_META[cat];
    chart += `    "${meta.emoji} ${meta.label}" : ${count}\n`;
  }
  chart += '```\n';

  return chart;
}

function generateAsciiBarChart(articles: ScoredArticle[]): string {
  const kwCount = new Map<string, number>();
  for (const a of articles) {
    for (const kw of a.keywords) {
      const normalized = kw.toLowerCase();
      kwCount.set(normalized, (kwCount.get(normalized) || 0) + 1);
    }
  }

  const sorted = Array.from(kwCount.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

  if (sorted.length === 0) return '';

  const maxVal = sorted[0][1];
  const maxBarWidth = 20;
  const maxLabelLen = Math.max(...sorted.map(([k]) => k.length));

  let chart = '```\n';
  for (const [label, value] of sorted) {
    const barLen = Math.max(1, Math.round((value / maxVal) * maxBarWidth));
    const bar = '█'.repeat(barLen) + '░'.repeat(maxBarWidth - barLen);
    chart += `${label.padEnd(maxLabelLen)} │ ${bar} ${value}\n`;
  }
  chart += '```\n';

  return chart;
}

function generateTagCloud(articles: ScoredArticle[]): string {
  const kwCount = new Map<string, number>();
  for (const a of articles) {
    for (const kw of a.keywords) {
      const normalized = kw.toLowerCase();
      kwCount.set(normalized, (kwCount.get(normalized) || 0) + 1);
    }
  }

  const sorted = Array.from(kwCount.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20);

  if (sorted.length === 0) return '';

  return sorted
    .map(([word, count], i) => i < 3 ? `**${word}**(${count})` : `${word}(${count})`)
    .join(' · ');
}

// ============================================================================
// Report Generation
// ============================================================================

function generateDigestReport(articles: ScoredArticle[], highlights: string, stats: {
  totalFeeds: number;
  successFeeds: number;
  totalArticles: number;
  filteredArticles: number;
  hours: number;
  dateStr: string;
}): string {
  let report = `# 📰 AI Blog Daily Digest — ${stats.dateStr}\n\n`;
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
      const medal = ['🥇', '🥈', '🥉'][i];
      const catMeta = CATEGORY_META[a.category];

      report += `${medal} **${a.title}**\n\n`;
      report += `${a.sourceName} · ${humanizeTime(a.pubDate)} · ${catMeta.emoji} ${catMeta.label}\n\n`;
      report += `> ${a.summary}\n\n`;
      if (a.reason) {
        report += `💡 **Why it matters**: ${a.reason}\n\n`;
      }
      if (a.keywords.length > 0) {
        report += `🏷️ ${a.keywords.join(', ')}\n\n`;
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

  const sortedCategories = Array.from(categoryGroups.entries())
    .sort((a, b) => b[1].length - a[1].length);

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
        report += `🏷️ ${a.keywords.join(', ')}\n\n`;
      }
      report += `---\n\n`;
    }
  }

  report += `*Generated on ${stats.dateStr} | Scanned ${stats.successFeeds} sources → Found ${stats.totalArticles} articles → Selected ${articles.length} articles*\n`;
  report += `*Based on [Hacker News Popularity Contest 2025](https://refactoringenglish.com/tools/hn-popularity/) RSS feeds list, curated by [Andrej Karpathy](https://x.com/karpathy).*\n`;
  report += `*Created by "Understand AI".*\n`;

  return report;
}

// ============================================================================
// Public entry: runDigest
// ============================================================================

export interface RunDigestOpts {
  ai: AIClient;
  lookbackHours: number;
  maxItems: number;
  date: string;
}

export interface RunDigestResult {
  markdown: string;
  stats: {
    totalFeeds: number;
    successFeeds: number;
    totalArticles: number;
    filteredArticles: number;
    selectedCount: number;
  };
  topArticles: Array<{ title: string; sourceName: string; link: string; category: string }>;
}

export async function runDigest(opts: RunDigestOpts): Promise<RunDigestResult> {
  const { ai, lookbackHours, maxItems, date } = opts;

  console.log(`[digest] === AI Daily Digest ===`);
  console.log(`[digest] Time range: ${lookbackHours} hours`);
  console.log(`[digest] Top N: ${maxItems}`);

  console.log(`[digest] Step 1/5: Fetching ${RSS_FEEDS.length} RSS feeds...`);
  const allArticles = await fetchAllFeeds(RSS_FEEDS);

  if (allArticles.length === 0) {
    throw new Error("No articles fetched from any feed. Check network connection.");
  }

  console.log(`[digest] Step 2/5: Filtering by time range (${lookbackHours} hours)...`);
  const cutoffTime = new Date(Date.now() - lookbackHours * 60 * 60 * 1000);
  const recentArticles = allArticles.filter(a => a.pubDate.getTime() > cutoffTime.getTime());

  console.log(`[digest] Found ${recentArticles.length} articles within last ${lookbackHours} hours`);

  if (recentArticles.length === 0) {
    throw new Error(`No articles found within the last ${lookbackHours} hours.`);
  }

  console.log(`[digest] Step 3/5: AI scoring ${recentArticles.length} articles...`);
  const scores = await scoreArticlesWithAI(recentArticles, ai);

  const scoredArticles = recentArticles.map((article, index) => {
    const score = scores.get(index) || { relevance: 5, quality: 5, timeliness: 5, category: 'other' as CategoryId, keywords: [] };
    return {
      ...article,
      totalScore: score.relevance + score.quality + score.timeliness,
      breakdown: score,
    };
  });

  scoredArticles.sort((a, b) => b.totalScore - a.totalScore);
  const topArticles = scoredArticles.slice(0, maxItems);

  console.log(`[digest] Top ${maxItems} articles selected (score range: ${topArticles[topArticles.length - 1]?.totalScore || 0} - ${topArticles[0]?.totalScore || 0})`);

  console.log(`[digest] Step 4/5: Generating AI summaries...`);
  const indexedTopArticles = topArticles.map((a, i) => ({ ...a, index: i }));
  const summaries = await summarizeArticles(indexedTopArticles, ai);

  const finalArticles: ScoredArticle[] = topArticles.map((a, i) => {
    const sm = summaries.get(i) || { summary: a.description.slice(0, 200), reason: '' };
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

  console.log(`[digest] Step 5/5: Generating today's highlights...`);
  const highlights = await generateHighlights(finalArticles, ai);

  const successfulSources = new Set(allArticles.map(a => a.sourceName));

  const markdown = generateDigestReport(finalArticles, highlights, {
    totalFeeds: RSS_FEEDS.length,
    successFeeds: successfulSources.size,
    totalArticles: allArticles.length,
    filteredArticles: recentArticles.length,
    hours: lookbackHours,
    dateStr: date,
  });

  console.log(`[digest] Done: ${successfulSources.size} sources → ${allArticles.length} articles → ${recentArticles.length} recent → ${finalArticles.length} selected`);

  return {
    markdown,
    stats: {
      totalFeeds: RSS_FEEDS.length,
      successFeeds: successfulSources.size,
      totalArticles: allArticles.length,
      filteredArticles: recentArticles.length,
      selectedCount: finalArticles.length,
    },
    topArticles: finalArticles.slice(0, 5).map((a) => ({
      title: a.title,
      sourceName: a.sourceName,
      link: a.link,
      category: a.category,
    })),
  };
}
