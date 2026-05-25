import type { ReportData, ClassifiedItem } from "./types.js";

const topicEmoji: Record<string, string> = {
  AI: "🤖", Programming: "💻", Japanese: "🇯🇵", English: "🇬🇧", Career: "💼", Business: "📈", Other: "🧩",
};

function itemBlock(item: ClassifiedItem, index: number) {
  return `### ${index}. ${topicEmoji[item.topic]} ${item.title}\n\n- **主题**：${item.topic}\n- **动作**：\`${item.action}\`\n- **分数**：${item.score}/100\n- **作者**：${item.author || "Unknown"}\n- **链接**：${item.url ? `[Reader / Source](${item.url})` : "无"}\n- **理由**：${item.reason}\n\n${item.summary ? `> ${item.summary}` : item.text ? `> ${item.text.slice(0, 280).replace(/\n+/g, " ")}` : ""}\n`;
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

  return `---\ntitle: Readwise Daily Report ${data.date}\ndate: ${data.date}\nsummary: ${data.aiSummary.replace(/\n/g, " ").slice(0, 140)}\ntags:\n  - Readwise\n  - Daily\n---\n\n# Readwise Daily｜${data.date}\n\n!!! summary "今日结论"\n    ${data.aiSummary}\n\n## 快速概览\n\n<div class="grid cards" markdown>\n\n-   :material-inbox-arrow-down: **输入**\n\n    ${data.items.length} 条新增/更新内容\n\n-   :material-star-four-points: **值得读**\n\n    ${read.length} 条 S 级，${skim.length} 条可扫读\n\n-   :material-tag-multiple: **主题分布**\n\n    ${Object.entries(byTopic).map(([k, v]) => `${k}: ${v}`).join(" · ")}\n\n-   :material-clock-outline: **窗口**\n\n    ${data.windowStart} → ${data.windowEnd}\n\n</div>\n\n## 今日重点\n\n${read.length ? read.map(itemBlock).join("\n") : "今天没有明显 S 级内容。很好，少读点垃圾也是进步。\n"}\n\n## 值得扫读\n\n${skim.length ? skim.map((i) => `- **[${i.topic}] [${i.title}](${i.url || "#"})**：${i.reason}`).join("\n") : "无。\n"}\n\n## 适合保存，暂不深读\n\n${save.length ? save.map((i) => `- **[${i.topic}] [${i.title}](${i.url || "#"})**：${i.reason}`).join("\n") : "无。\n"}\n\n## 跳过\n\n${ignored.length ? ignored.slice(0, 8).map((i) => `- ${i.title}：${i.reason}`).join("\n") : "无。\n"}\n\n## 高频关键词\n\n${data.keywords.map((k) => `\`${k}\``).join(" · ") || "暂无"}\n\n## 我的学习趋势\n\n${trendText(data)}\n\n## 今天只做一件事\n\n!!! tip "Action"\n    ${read[0] ? `读完 **${read[0].title}**，并写下 3 行可执行笔记：它说明了什么、和我有什么关系、下一步做什么。` : "不读。整理昨天的笔记。注意力也是资产，不是 RSS 焚化炉。"}\n`;
}

function trendText(data: ReportData) {
  const topics = data.items.filter((i) => i.action !== "IGNORE").map((i) => i.topic);
  const top = Object.entries(topics.reduce<Record<string, number>>((a, t) => (a[t] = (a[t] || 0) + 1, a), {})).sort((a, b) => b[1] - a[1])[0]?.[0];
  if (!top) return "今天没有明显趋势。";
  return `今天的高信号内容主要集中在 **${top}**。建议继续把阅读沉淀到可执行项目、求职表达或语言学习材料里，而不是只收藏链接。`;
}
