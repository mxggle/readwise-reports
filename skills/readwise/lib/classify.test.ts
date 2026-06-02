import { describe, expect, it } from "vitest";
import { classify, keywords } from "./classify.js";
import type { SourceItem } from "./types.js";

function makeItem(overrides: Partial<SourceItem> & { id: string; title: string; text: string }): SourceItem {
  return {
    author: "Author",
    source: "reader-document",
    tags: [],
    ...overrides,
  };
}

describe("classify", () => {
  it("promotes goal-aligned, substantive, actionable articles to READ", () => {
    const [item] = classify([
      makeItem({
        id: "deep-rl",
        title: "Introduction to Deep RL and DQN",
        summary:
          "A practical guide to reward signals, policy optimization, exploration, credit assignment, replay buffers, target networks, and how to implement a small DQN project.",
        text:
          "This tutorial explains the core mechanics of Deep Reinforcement Learning for AI engineers. It shows how reward signals shape behavior, how policy optimization works, how replay buffers and target networks stabilize DQN training, and gives concrete implementation steps for a small project.",
        wordCount: 1306,
      }),
    ]);

    expect(item.topic).toBe("AI");
    expect(item.action).toBe("READ");
    expect(item.score).toBeGreaterThanOrEqual(78);
  });

  it("keeps trend/news items as SKIM when they are relevant but not very actionable", () => {
    const [item] = classify([
      makeItem({
        id: "ai-news",
        title: "Claude Opus 4.8 got safer today",
        summary: "Some agent tests got weirder. The release improves safety evaluations and reports a few benchmark changes.",
        text: "Some agent tests got weirder. The release improves safety evaluations and reports a few benchmark changes.",
        wordCount: 1867,
      }),
    ]);

    expect(item.topic).toBe("AI");
    expect(item.action).toBe("SKIM");
    expect(item.score).toBeGreaterThanOrEqual(58);
    expect(item.score).toBeLessThan(78);
  });

  it("downgrades Reader entries with no substantive text even when metadata reports many words", () => {
    const [item] = classify([
      makeItem({
        id: "comments-only",
        title: "The Speed of Prototyping in the Age of AI",
        text: "Comments",
        wordCount: 1375,
      }),
    ]);

    expect(item.topic).toBe("AI");
    expect(item.action).toBe("IGNORE");
    expect(item.score).toBeLessThan(42);
  });

  it("keeps useful but weakly related articles as SAVE", () => {
    const [item] = classify([
      makeItem({
        id: "solar",
        title: "Solar desalination prototype makes fresh water without toxic brine",
        summary: "A research team describes a solar desalination prototype and early lab results.",
        text: "A research team describes a solar desalination prototype and early lab results with deployment constraints.",
        wordCount: 1200,
      }),
    ]);

    expect(item.topic).toBe("Other");
    expect(item.action).toBe("SAVE");
    expect(item.score).toBeGreaterThanOrEqual(42);
    expect(item.score).toBeLessThan(58);
  });

  it("surfaces intrinsically valuable off-goal articles to avoid a knowledge cocoon", () => {
    const [item] = classify([
      makeItem({
        id: "desalination-breakthrough",
        title: "New solar desalination breakthrough makes fresh water without toxic brine",
        summary:
          "Researchers propose a passive solar desalination architecture that avoids toxic brine and reports measured efficiency gains in lab trials.",
        text:
          "The article gives a detailed analysis of a new solar desalination method, explains the mechanism, compares it with reverse osmosis, reports concrete efficiency metrics, and discusses deployment constraints for water-stressed regions. It sits outside the usual personal focus areas, but it has broad public value and a genuinely novel technical approach.",
        wordCount: 1800,
      }),
    ]);

    expect(item.topic).toBe("Other");
    expect(item.action).toBe("SKIM");
    expect(item.score).toBeGreaterThanOrEqual(58);
    expect(item.score).toBeLessThan(78);
  });

  it("removes low-signal newsletter filler from keywords", () => {
    const items = classify([
      makeItem({
        id: "newsletter",
        title: "New AI support app had just launched",
        summary: "The new app had just added support for accounts and code workflows.",
        text: "The article explains Claude Code workflow design, evaluation methods, and practical agent implementation steps for AI engineering teams.",
        tags: ["AI"],
      }),
    ]);

    expect(keywords(items)).toEqual(expect.arrayContaining(["claude", "workflow"]));
    expect(keywords(items)).not.toEqual(expect.arrayContaining(["new", "had", "just", "support"]));
  });
});
