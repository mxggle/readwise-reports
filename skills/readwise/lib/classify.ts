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
const goalSignals = /agent harness|deployment layer|workflow|eval|memory|context engineering|frontend|career|japan|japanese|english|rlhf|grpo|post-training|ai engineer|deep rl|dqn|reinforcement learning|reward signal|policy optimization|credit assignment/i;
const substanceSignals = /guide|tutorial|explains?|analysis|architecture|implementation|method|framework|case study|benchmark|metrics?|research|technical|机制|方法|案例|数据|架构|实现|原理/i;
const noveltySignals = /new|novel|counterintuitive|breakthrough|research|learns?|proposes?|compared?|versus|vs\.?|unexpected|反常识|新颖|提出|对比|突破/i;
const actionSignals = /implement|build|workflow|project|steps?|practice|checklist|playbook|template|code|api|debug|optimi[sz]e|训练|项目|实践|落地|步骤|代码/i;
const foundationalLearningSignals = /deep rl|dqn|reinforcement learning|reward signals?|policy optimization|credit assignment|backpropagation|fundamental/i;
const broadValueSignals = /public value|water-stressed|climate|energy|health|education|policy|infrastructure|science|fresh water|desalination|economics|housing|transportation|governance|公共|气候|能源|医疗|教育|政策|基础设施|科学|经济|住房|交通/i;
const emptyReaderText = /^(comments?|no content|this tweet contains no text)$/i;

const topicGoalBase: Record<Topic, number> = {
  AI: 6,
  Programming: 6,
  Japanese: 7,
  English: 7,
  Career: 7,
  Business: 4,
  Other: 3.5,
};

function clampDimension(value: number): number {
  return Math.max(0, Math.min(10, value));
}

function actualText(item: SourceItem): string {
  return `${item.summary || ""}\n${item.text || ""}`.trim();
}

function hasSubstantiveText(item: SourceItem): boolean {
  const text = actualText(item);
  if (!text || emptyReaderText.test(text.trim())) return false;
  return text.replace(/\s+/g, " ").length >= 80;
}

function scoreGoalFit(topic: Topic, hay: string, item: SourceItem): number {
  let score = topicGoalBase[topic];
  if (goalSignals.test(hay)) score += 2.5;
  if (item.source === "readwise-highlight") score += 1;
  if (/\b(ai|llm|agent|model|python|typescript|react|japanese|english|career)\b/i.test(hay)) score += 0.5;
  return clampDimension(score);
}

function scoreSubstance(hay: string, item: SourceItem): number {
  if (!hasSubstantiveText(item)) return 1;

  const textLength = actualText(item).length;
  let score = textLength > 900 ? 6.5 : textLength > 400 ? 6 : 4;
  if (substanceSignals.test(hay)) score += 1.5;
  if (foundationalLearningSignals.test(hay)) score += 2;
  if (/\b\d+(\.\d+)?%?|\b(v\d+|[A-Z]{2,})\b/.test(hay)) score += 0.5;
  if (item.source === "readwise-highlight") score += 0.5;
  if (weakSignals.test(hay)) score -= 2;
  return clampDimension(score);
}

function scoreNovelty(hay: string, item: SourceItem): number {
  if (!hasSubstantiveText(item)) return 2;

  let score = 4;
  if (noveltySignals.test(hay)) score += 1.5;
  if (/research|paper|microsoft research|deep rl|dqn|breakthrough|first|new/i.test(hay)) score += 1;
  if (foundationalLearningSignals.test(hay)) score += 1;
  if (goalSignals.test(hay)) score += 1;
  if (weakSignals.test(hay)) score -= 1.5;
  return clampDimension(score);
}

function scoreActionability(hay: string, item: SourceItem): number {
  if (!hasSubstantiveText(item)) return 1;

  let score = 3;
  if (actionSignals.test(hay)) score += 2;
  if (/tutorial|guide|how to|implementation|workflow|project|practice/i.test(hay)) score += 1;
  if (foundationalLearningSignals.test(hay)) score += 3;
  if (goalSignals.test(hay) && substanceSignals.test(hay)) score += 1;
  if (item.source === "readwise-highlight") score += 1;
  if (weakSignals.test(hay)) score -= 1.5;
  return clampDimension(score);
}

function scoreBroadValue(hay: string, item: SourceItem): number {
  if (!hasSubstantiveText(item)) return 1;

  let score = 3;
  if (broadValueSignals.test(hay)) score += 3;
  if (noveltySignals.test(hay) && substanceSignals.test(hay)) score += 1;
  if (/\b\d+(\.\d+)?%?|\b(v\d+|[A-Z]{2,})\b/.test(hay)) score += 0.5;
  if (weakSignals.test(hay)) score -= 1.5;
  return clampDimension(score);
}

function weightedScore(dimensions: { goalFit: number; substance: number; novelty: number; actionability: number }): number {
  return Math.round(
    dimensions.goalFit * 3.5 +
    dimensions.substance * 2.5 +
    dimensions.novelty * 2 +
    dimensions.actionability * 2,
  );
}

function intrinsicScore(dimensions: { substance: number; novelty: number; actionability: number; broadValue: number }): number {
  return Math.round(
    dimensions.substance * 3.2 +
    dimensions.novelty * 3 +
    dimensions.broadValue * 2 +
    dimensions.actionability,
  );
}

export function classify(items: SourceItem[]): ClassifiedItem[] {
  return items.map((item) => {
    const hay = `${item.title}\n${item.author || ""}\n${item.tags.join(" ")}\n${item.summary || ""}\n${item.text}`;
    const topic = topicRules.find(([, re]) => re.test(hay))?.[0] || "Other";
    const dimensions = {
      goalFit: scoreGoalFit(topic, hay, item),
      substance: scoreSubstance(hay, item),
      novelty: scoreNovelty(hay, item),
      actionability: scoreActionability(hay, item),
      broadValue: scoreBroadValue(hay, item),
    };
    const score = Math.max(0, Math.min(100, Math.max(weightedScore(dimensions), intrinsicScore(dimensions))));
    const action: ClassifiedItem["action"] = score >= 78 ? "READ" : score >= 58 ? "SKIM" : score >= 42 ? "SAVE" : "IGNORE";
    const reason = action === "READ" ? "和长期目标强相关，值得完整读" : action === "SKIM" ? "有信息量，但不用深读" : action === "SAVE" ? "未来特定场景可能有用" : "信息密度或相关性偏低";
    return { ...item, topic, score, action, reason };
  }).sort((a, b) => b.score - a.score);
}

export function keywords(items: ClassifiedItem[]) {
  const stop = new Set(
    "the a an and or of to in for with on is are was were this that from by as at it be into your you we our ai new had just support supports supported added add app apps launched launch today read online good morning plus newsletter accounts account what have has not how but its her his him she he they them their there here than then when where who whom why can could would should will may might more most less very about after before over under out up down if no yes all any each other same own now first one two three four five some like years year".split(" "),
  );
  const counts = new Map<string, number>();
  for (const item of items.filter((i) => i.action !== "IGNORE")) {
    const text = `${item.title} ${item.summary || ""} ${item.text.slice(0, 600)} ${item.tags.join(" ")}`.toLowerCase();
    for (const word of text.match(/[a-z][a-z0-9-]{2,}|[\u3040-\u30ff\u3400-\u9fff]{2,}/g) || []) {
      if (!stop.has(word)) counts.set(word, (counts.get(word) || 0) + 1);
    }
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k]) => k);
}
