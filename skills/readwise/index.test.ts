import { describe, expect, it, vi } from "vitest";
import type { SkillContext } from "../_sdk/index.js";

vi.mock("./lib/readwise-api.js", () => ({
  dedupe: vi.fn((items) => items),
  fetchHighlights: vi.fn(),
  fetchReaderDocuments: vi.fn(),
}));

vi.mock("./lib/analyze.js", () => ({
  analyzeItems: vi.fn(async (_ctx, items) => items),
}));

import run from "./index.js";
import { fetchHighlights, fetchReaderDocuments } from "./lib/readwise-api.js";

const mockFetchHighlights = vi.mocked(fetchHighlights);
const mockFetchReaderDocuments = vi.mocked(fetchReaderDocuments);

function makeContext(overrides: Partial<SkillContext> = {}): SkillContext {
  return {
    config: {
      id: "readwise",
      title: "Readwise",
      enabled: true,
      ai: { mode: "auto", outputLanguage: "zh-CN" },
    },
    ai: { complete: vi.fn() },
    log: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    },
    dryRun: false,
    date: "2026-06-02",
    timezone: "Asia/Tokyo",
    paths: {
      outputDir: "docs/readwise",
      rawDir: "generated/raw/readwise",
      generatedDir: "generated",
    },
    writer: {
      writeReport: vi.fn(),
      writeRaw: vi.fn(),
    },
    store: {
      filterUnprocessed: vi.fn(async () => ({ fresh: [], skipped: [] })),
      markProcessed: vi.fn(),
    },
    ...overrides,
  } as SkillContext;
}

describe("readwise skill run", () => {
  it("returns without AI, writes, or processed-state updates when there are no fresh items", async () => {
    mockFetchHighlights.mockResolvedValueOnce([]);
    mockFetchReaderDocuments.mockResolvedValueOnce([
      {
        id: "r-old",
        title: "Already processed",
        source: "reader-document",
        text: "Substantive but already processed content.",
        tags: [],
      },
    ]);
    const ctx = makeContext({
      store: {
        filterUnprocessed: async <T,>(_items: T[]) => ({
          fresh: [] as T[],
          skipped: [
            {
              id: "r-old",
              title: "Already processed",
              source: "reader-document" as const,
              text: "Substantive but already processed content.",
              tags: [],
            },
          ] as T[],
        }),
        markProcessed: vi.fn(),
      },
    });

    const result = await run(ctx);

    expect(result).toEqual({ itemsProcessed: 0, itemsSkipped: 0 });
    expect(ctx.ai.complete).not.toHaveBeenCalled();
    expect(ctx.writer.writeRaw).not.toHaveBeenCalled();
    expect(ctx.writer.writeReport).not.toHaveBeenCalled();
    expect(ctx.store.markProcessed).not.toHaveBeenCalled();
  });
});
