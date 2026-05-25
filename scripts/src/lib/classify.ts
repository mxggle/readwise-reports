import type { ClassifiedItem, SourceItem, Topic } from "./types.js";

const topicRules: Array<[Topic, RegExp]> = [
  ["AI", /\b(ai|llm|agent|claude|openai|anthropic|gemini|model|rag|eval|prompt|context|memory|rlhf|grpo|inference|token)\b/i],
  ["Programming", /\b(programming|typescript|javascript|react|next\.js|vue|python|github|api|cli|database|frontend|backend|code|software|datasette)\b/i],
  ["Japanese", /(日本語|日语|jlpt|n3|n2|kanji|grammar|vocabulary|敬語|読解)/i],
  ["English", /\b(english|ielts|vocabulary|grammar|speaking|listening|writing|phrase|podcast)\b/i],
  ["Career", /\b(career|job|interview|resume|hiring|engineer|pm|designer|salary|求职|面试|職務経歴書|転職)\b/i],
  ["Business", /\b(business|startup|saas|revenue|enterprise|market|sales|customer|pricing|investment|vc|capital)\b/i],
];

const weakSignals = /tim denning|sponsor|discount|sale|subscribe|promotion|try it here|this tweet contains no text/i;
const strongSignals = /agent harness|deployment layer|workflow|eval|memory|context engineering|frontend|career|japan|japanese|english|rlhf|grpo|post-training|ai engineer/i;

export function classify(items: SourceItem[]): ClassifiedItem[] {
  return items.map((item) => {
    const hay = `${item.title}\n${item.author || ""}\n${item.tags.join(" ")}\n${item.summary || ""}\n${item.text}`;
    const topic = topicRules.find(([, re]) => re.test(hay))?.[0] || "Other";
    let score = 40;
    if (strongSignals.test(hay)) score += 35;
    if (item.source === "readwise-highlight") score += 15;
    if ((item.wordCount || item.text.length / 5) > 800) score += 10;
    if (weakSignals.test(hay)) score -= 35;
    if ((item.wordCount || 0) < 80 && item.source === "reader-document") score -= 20;
    if (["AI", "Programming", "Japanese", "English", "Career"].includes(topic)) score += 10;
    score = Math.max(0, Math.min(100, score));
    const action: ClassifiedItem["action"] = score >= 75 ? "READ" : score >= 55 ? "SKIM" : score >= 40 ? "SAVE" : "IGNORE";
    const reason = action === "READ" ? "和长期目标强相关，值得完整读" : action === "SKIM" ? "有信息量，但不用深读" : action === "SAVE" ? "未来特定场景可能有用" : "信息密度或相关性偏低";
    return { ...item, topic, score, action, reason };
  }).sort((a, b) => b.score - a.score);
}

export function keywords(items: ClassifiedItem[]) {
  const stop = new Set("the a an and or of to in for with on is are was were this that from by as at it be into your you we our ai".split(" "));
  const counts = new Map<string, number>();
  for (const item of items.filter((i) => i.action !== "IGNORE")) {
    const text = `${item.title} ${item.summary || ""} ${item.tags.join(" ")}`.toLowerCase();
    for (const word of text.match(/[a-z][a-z0-9-]{2,}|[\u3040-\u30ff\u3400-\u9fff]{2,}/g) || []) {
      if (!stop.has(word)) counts.set(word, (counts.get(word) || 0) + 1);
    }
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k]) => k);
}
