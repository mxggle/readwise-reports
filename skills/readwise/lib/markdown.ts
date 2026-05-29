import type { ReportData, ClassifiedItem } from "./types.js";

const topicEmoji: Record<string, string> = {
  AI: "🤖", Programming: "💻", Japanese: "🇯🇵", English: "🇬🇧", Career: "💼", Business: "📈", Other: "🧩",
};

function itemBlock(item: ClassifiedItem, index: number) {
  const meta = [
    `- **主题**：${item.topic}`,
    `- **动作**：\`${item.action}\``,
    `- **分数**：${item.score}/100`,
    `- **作者**：${item.author || "Unknown"}`,
    `- **链接**：${item.url ? `[Reader / Source](${item.url})` : "无"}`,
  ].join("\n");

  if (item.aiAnalysis) {
    const { synopsis, keyPoints, novelAngles, verdict } = item.aiAnalysis;
    const keyPointsText = keyPoints.map((p) => `  - ${p}`).join("\n");
    const novelText = novelAngles.length > 0 ? `\n**新颖点**\n\n${novelAngles.map((p) => `  - ${p}`).join("\n")}\n` : "";
    return `### ${index}. ${topicEmoji[item.topic] ?? "🧩"} ${item.title}\n\n${meta}\n\n**是什么**\n\n${synopsis}\n\n**亮点**\n\n${keyPointsText}\n${novelText}\n**综合判断**：${verdict}\n`;
  }

  const preview = item.summary || item.text.slice(0, 280).replace(/\n+/g, " ");
  return `### ${index}. ${topicEmoji[item.topic] ?? "🧩"} ${item.title}\n\n${meta}\n- **理由**：${item.reason}\n\n${preview ? `> ${preview}` : ""}\n`;
}

function escapeYamlValue(value: string): string {
  // Escape backslashes and double quotes for safe YAML double-quoted string
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

export function renderDaily(data: ReportData) {
  const read = data.items.filter((i) => i.action === "READ").slice(0, 3);
  const skim = data.items.filter((i) => i.action === "SKIM").slice(0, 5);
  const save = data.items.filter((i) => i.action === "SAVE").slice(0, 5);
  const ignored = data.items.filter((i) => i.action === "IGNORE");
  const byTopic = data.items.reduce<Record<string, number>>((acc, i) => {
    acc[i.topic] = (acc[i.topic] || 0) + 1;
    return acc;
  }, {});

  const safeSummary = escapeYamlValue(data.aiSummary.replace(/\n/g, " ").slice(0, 140));

  return `---
title: Readwise Daily Report ${data.date}
date: ${data.date}
summary: "${safeSummary}"
tags:
  - Readwise
  - Daily
---

# Readwise Daily｜${data.date}

!!! summary "今日结论"
    ${data.aiSummary}

## 快速概览

<div class="grid cards" markdown>

-   :material-inbox-arrow-down: **输入**

    ${data.items.length} 条新增/更新内容

-   :material-star-four-points: **值得读**

    ${read.length} 条 S 级，${skim.length} 条可扫读

-   :material-tag-multiple: **主题分布**

    ${Object.entries(byTopic).map(([k, v]) => `${k}: ${v}`).join(" · ")}

-   :material-clock-outline: **窗口**

    ${data.windowStart} → ${data.windowEnd}

</div>

## 今日重点

${read.length ? read.map(itemBlock).join("\n") : "今天没有明显 S 级内容。很好，少读点垃圾也是进步。\n"}

## 值得扫读

${skim.length ? skim.map((i) => `- **[${i.topic}] [${i.title}](${i.url || "#"})**：${i.reason}`).join("\n") : "无。\n"}

## 适合保存，暂不深读

${save.length ? save.map((i) => `- **[${i.topic}] [${i.title}](${i.url || "#"})**：${i.reason}`).join("\n") : "无。\n"}

## 跳过

${ignored.length ? ignored.slice(0, 8).map((i) => `- ${i.title}：${i.reason}`).join("\n") : "无。\n"}

## 高频关键词

${data.keywords.map((k) => `\`${k}\``).join(" · ") || "暂无"}

## 我的学习趋势

${trendText(data)}

## 今天只做一件事

!!! tip "Action"
    ${read[0] ? `读完 **${read[0].title}**，并写下 3 行可执行笔记：它说明了什么、和我有什么关系、下一步做什么。` : "不读。整理昨天的笔记。注意力也是资产，不是 RSS 焚化炉。"}
`;
}

function trendText(data: ReportData) {
  const topics = data.items.filter((i) => i.action !== "IGNORE").map((i) => i.topic);
  const top = Object.entries(topics.reduce<Record<string, number>>((a, t) => (a[t] = (a[t] || 0) + 1, a), {})).sort((a, b) => b[1] - a[1])[0]?.[0];
  if (!top) return "今天没有明显趋势。";
  return `今天的高信号内容主要集中在 **${top}**。建议继续把阅读沉淀到可执行项目、求职表达或语言学习材料里，而不是只收藏链接。`;
}
