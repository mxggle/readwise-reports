import { describe, expect, it } from "vitest";
import { buildTopicPage, collectTopicItemsFromReport, mdToUrl } from "../src/build-index.js";

describe("mdToUrl", () => {
  it("converts a dated report path to a directory URL", () => {
    expect(mdToUrl("github-trends/2026-06-12.md")).toBe("github-trends/2026-06-12/");
  });
  it("converts a sibling topic page to a directory URL", () => {
    expect(mdToUrl("programming.md")).toBe("programming/");
  });
  it("collapses index.md to the current directory", () => {
    expect(mdToUrl("index.md")).toBe("./");
    expect(mdToUrl("hn/index.md")).toBe("hn/");
  });
  it("leaves non-markdown hrefs untouched", () => {
    expect(mdToUrl("https://example.com/x")).toBe("https://example.com/x");
  });
});

describe("topic index generation", () => {
  it("collects topic items from Readwise report markdown", () => {
    const report = {
      date: "2026-06-12",
      href: "2026-06-12.md",
      title: "Readwise Daily Report 2026-06-12",
      summary: "",
    };
    const markdown = [
      "## 今日重点",
      "",
      "### 1. 💻 Example Architecture Post",
      "",
      "- **主题**：Programming",
      "- **动作**：`READ`",
      "- **分数**：91/100",
      "- **链接**：[Reader / Source](https://example.com/read)",
      "",
      "## 值得扫读",
      "",
      "- **[Programming] [A practical TypeScript note](https://example.com/ts)**：有信息量",
      "- **[AI] [An unrelated AI note](https://example.com/ai)**：有信息量",
    ].join("\n");

    const items = collectTopicItemsFromReport(report, markdown);

    expect(items.filter((i) => i.topic === "Programming")).toEqual([
      {
        topic: "Programming",
        date: "2026-06-12",
        title: "Example Architecture Post",
        url: "https://example.com/read",
        reportHref: "../readwise/2026-06-12.md",
        action: "READ",
        score: "91/100",
        reason: "",
      },
      {
        topic: "Programming",
        date: "2026-06-12",
        title: "A practical TypeScript note",
        url: "https://example.com/ts",
        reportHref: "../readwise/2026-06-12.md",
        action: "",
        score: "",
        reason: "有信息量",
      },
    ]);
  });

  it("builds a topic page with real report links instead of placeholder text", () => {
    const page = buildTopicPage("Programming", [
      {
        topic: "Programming",
        date: "2026-06-12",
        title: "Example Architecture Post",
        url: "https://example.com/read",
        reportHref: "../readwise/2026-06-12.md",
        action: "READ",
        score: "91/100",
        reason: "",
      },
    ]);

    expect(page).toContain("# Programming");
    expect(page).toContain("## 2026-06");
    expect(page).toContain("[Example Architecture Post](https://example.com/read)");
    expect(page).toContain("[日报](../readwise/2026-06-12.md)");
    expect(page).not.toContain("这个主题页会随着日报生成逐步沉淀链接。");
  });

  it("normalizes whitespace in collected list titles", () => {
    const report = {
      date: "2026-06-12",
      href: "2026-06-12.md",
      title: "Readwise Daily Report 2026-06-12",
      summary: "",
    };
    const markdown = [
      "## 适合保存，暂不深读",
      "",
      "- **[AI] [Why cultivating agency matters more than cultivating skills in the AI era |",
      " Max Schoening](https://example.com/agency)**：未来特定场景可能有用",
    ].join("\n");

    expect(collectTopicItemsFromReport(report, markdown)[0].title).toBe(
      "Why cultivating agency matters more than cultivating skills in the AI era | Max Schoening",
    );
  });
});
