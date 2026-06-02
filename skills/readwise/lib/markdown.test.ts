import { describe, expect, it } from "vitest";
import { renderDaily } from "./markdown.js";
import type { ClassifiedItem, ReportData } from "./types.js";

function makeItem(overrides: Partial<ClassifiedItem> = {}): ClassifiedItem {
  return {
    id: "item-1",
    title: "The Speed of Prototyping in the Age of AI",
    author: "Unknown",
    url: "https://read.readwise.io/read/item-1",
    source: "reader-document",
    text: "The article discusses how AI changes product prototyping workflows.",
    tags: [],
    topic: "AI",
    score: 72,
    action: "SKIM",
    reason: "有信息量，但不用深读",
    ...overrides,
  };
}

function makeReport(items: ClassifiedItem[]): ReportData {
  return {
    date: "2026-06-01",
    generatedAt: "2026-06-01T00:00:00.000Z",
    timezone: "Asia/Tokyo",
    windowStart: "2026-05-31T00:00:00.000Z",
    windowEnd: "2026-06-01T00:00:00.000Z",
    items,
    keywords: ["AI"],
    aiSummary: "今日阅读重点集中在 AI。",
  };
}

describe("renderDaily", () => {
  it("numbers READ items starting from 1", () => {
    const markdown = renderDaily(
      makeReport([
        makeItem({
          action: "READ",
          aiAnalysis: {
            synopsis: "这篇文章值得完整读。",
            keyPoints: ["重点一"],
            novelAngles: [],
            verdict: "值得读。",
          },
        }),
      ]),
    );

    expect(markdown).toContain("### 1. 🤖 The Speed of Prototyping in the Age of AI");
    expect(markdown).not.toContain("### 0.");
  });

  it("includes a concise summary for SKIM items", () => {
    const markdown = renderDaily(
      makeReport([
        makeItem({
          aiAnalysis: {
            synopsis: "这篇文章说明 AI 正把原型开发从按周推进压缩到按小时验证。",
            keyPoints: ["团队可以更快验证想法。"],
            novelAngles: [],
            verdict: "适合扫读，重点看工作流变化。",
          },
        }),
      ]),
    );

    expect(markdown).toContain("## 值得扫读");
    expect(markdown).toContain("  > 这篇文章说明 AI 正把原型开发从按周推进压缩到按小时验证。");
    expect(markdown).not.toContain("**是什么**");
  });

  it("falls back to the source summary when SKIM AI analysis is unavailable", () => {
    const markdown = renderDaily(
      makeReport([
        makeItem({
          summary: "AI 工具正在缩短产品想法从构思到可交互原型的周期。",
        }),
      ]),
    );

    expect(markdown).toContain("  > AI 工具正在缩短产品想法从构思到可交互原型的周期。");
  });

  it("normalizes and truncates long SKIM source summaries", () => {
    const markdown = renderDaily(
      makeReport([
        makeItem({
          summary: `${"AI 工具会快速制造大量项目。".repeat(20)}\n\n第二段不应该原样展开。`,
        }),
      ]),
    );

    const quoteLine = markdown.split("\n").find((line) => line.startsWith("  > "));
    expect(quoteLine).toBeDefined();
    expect(quoteLine).not.toContain("\n");
    expect(quoteLine!.length).toBeLessThanOrEqual(170);
    expect(quoteLine).toContain("...");
  });

  it("uses the highest-priority non-ignored item for the daily action when there are no READ items", () => {
    const markdown = renderDaily(
      makeReport([
        makeItem({
          title: "Hackers Simply Asked Meta AI for Instagram Access",
          action: "SKIM",
          score: 74,
          aiAnalysis: {
            synopsis: "这篇文章说明 AI 支持系统被过度授权后会变成账户接管入口。",
            keyPoints: ["AI 客服权限过大。"],
            novelAngles: [],
            verdict: "值得扫读并检查权限边界。",
          },
        }),
      ]),
    );

    expect(markdown).not.toContain("不读。整理昨天的笔记。");
    expect(markdown).toContain("检查 **Hackers Simply Asked Meta AI for Instagram Access**");
  });

  it("keeps every line of a multi-line summary inside the summary admonition", () => {
    const markdown = renderDaily(
      makeReport([
        makeItem({
          action: "SKIM",
        }),
      ]),
    );
    const summaryMarkdown = renderDaily({
      ...makeReport([]),
      aiSummary: "第一行总结。\n第二行仍然应该在 admonition 里。",
    });

    expect(markdown).toContain("!!! summary");
    expect(summaryMarkdown).toContain("    第一行总结。\n    第二行仍然应该在 admonition 里。");
  });
});
