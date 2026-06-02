import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("execa", () => ({ execa: vi.fn() }));
import { execa } from "execa";
import { dedupe, fetchHighlights, fetchReaderDocuments } from "../../skills/readwise/lib/readwise-api.js";
import type { SourceItem } from "../../skills/readwise/lib/types.js";

const mockExeca = execa as unknown as ReturnType<typeof vi.fn>;

function highlight(id: string, title: string, author: string, text: string): SourceItem {
  return { id, title, author, source: "readwise-highlight", text, tags: [] };
}

describe("dedupe", () => {
  it("keeps every highlight from the same book (shared title/author, distinct ids)", () => {
    const items = [
      highlight("h-1", "Thinking, Fast and Slow", "Kahneman", "highlight one"),
      highlight("h-2", "Thinking, Fast and Slow", "Kahneman", "highlight two"),
      highlight("h-3", "Thinking, Fast and Slow", "Kahneman", "highlight three"),
    ];
    expect(dedupe(items).map((i) => i.id)).toEqual(["h-1", "h-2", "h-3"]);
  });

  it("collapses items that share the same id (true duplicates within a batch)", () => {
    const items = [
      highlight("h-1", "Book A", "X", "first"),
      highlight("h-1", "Book A", "X", "first seen again"),
    ];
    expect(dedupe(items).map((i) => i.id)).toEqual(["h-1"]);
  });
});

describe("fetchReaderDocuments pagination", () => {
  const realFetch = globalThis.fetch;
  const longBody = "This article has enough substantive body text to be eligible for the daily report and exercise pagination behavior.";

  afterEach(() => {
    globalThis.fetch = realFetch;
    delete process.env.READWISE_TOKEN;
    delete process.env.READWISE_USE_CLI;
  });

  it("follows nextPageCursor across pages", async () => {
    process.env.READWISE_TOKEN = "test-token";
    const calls: string[] = [];
    globalThis.fetch = (async (url: string) => {
      calls.push(String(url));
      const body = String(url).includes("pageCursor=CURSOR2")
        ? { count: 2, nextPageCursor: null, results: [{ id: 2, title: "B", html_content: `<p>${longBody}</p>`, category: "article", parent_id: null }] }
        : { count: 2, nextPageCursor: "CURSOR2", results: [{ id: 1, title: "A", html_content: `<p>${longBody}</p>`, category: "article", parent_id: null }] };
      return { ok: true, status: 200, json: async () => body } as Response;
    }) as typeof fetch;

    const docs = await fetchReaderDocuments("2026-01-01T00:00:00Z");

    expect(docs.map((d) => d.id)).toEqual(["r-1", "r-2"]);
    expect(calls).toHaveLength(2);
    expect(calls[0]).toContain("updatedAfter=");
    expect(calls[0]).toContain("withHtmlContent=true");
    expect(calls[0]).toContain("limit=100");
    expect(calls[1]).toContain("pageCursor=CURSOR2");
  });

  it("stops when the cursor stops advancing (guards against an infinite loop)", async () => {
    process.env.READWISE_TOKEN = "test-token";
    let requests = 0;
    globalThis.fetch = (async () => {
      requests++;
      return {
        ok: true,
        status: 200,
        json: async () => ({ nextPageCursor: "STUCK", results: [{ id: requests, title: `Doc ${requests}`, html_content: `<p>${longBody}</p>`, category: "article", parent_id: null }] }),
      } as Response;
    }) as typeof fetch;

    const docs = await fetchReaderDocuments("2026-01-01T00:00:00Z");

    expect(requests).toBe(2); // page 1 sets cursor=STUCK, page 2 returns STUCK again → stop
    expect(docs).toHaveLength(2);
  });

  it("maps html_content to text and filters Reader child docs plus empty placeholders", async () => {
    process.env.READWISE_TOKEN = "test-token";
    globalThis.fetch = (async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        nextPageCursor: null,
        results: [
          {
            id: "article",
            title: "Useful article",
            html_content: "<article><h1>Useful article</h1><p>A substantive explanation of AI workflow design with concrete implementation steps.</p></article>",
            summary: "Comments",
            category: "article",
            parent_id: null,
            tags: { ai: {} },
          },
          {
            id: "child-highlight",
            title: "Reader highlight child",
            html_content: "<p>A child highlight should not be treated as a full document.</p>",
            category: "highlight",
            parent_id: "article",
          },
          {
            id: "comments",
            title: "Comments only",
            html_content: "",
            summary: "Comments",
            category: "article",
            parent_id: null,
          },
          {
            id: "short-summary",
            title: "Short summary",
            html_content: `<p>${longBody}</p>`,
            summary: "Good morning.",
            category: "article",
            parent_id: null,
          },
        ],
      }),
    }) as Response) as typeof fetch;

    const docs = await fetchReaderDocuments("2026-01-01T00:00:00Z");

    expect(docs).toHaveLength(2);
    expect(docs[0]).toMatchObject({
      id: "r-article",
      title: "Useful article",
      text: "Useful article A substantive explanation of AI workflow design with concrete implementation steps.",
      summary: undefined,
      tags: ["ai"],
    });
    expect(docs[1]).toMatchObject({
      id: "r-short-summary",
      summary: undefined,
      text: longBody,
    });
  });
});

describe("fetchHighlights CLI fallback", () => {
  afterEach(() => {
    mockExeca.mockReset();
    delete process.env.READWISE_TOKEN;
    delete process.env.READWISE_USE_CLI;
  });

  it("pages through CLI highlights and maps book_* metadata", async () => {
    process.env.READWISE_USE_CLI = "true";
    mockExeca
      .mockResolvedValueOnce({
        stdout: JSON.stringify({
          next: "https://readwise.io/api/v2/highlights/?page=2",
          results: [{ id: 1, text: "t1", note: "n1", url: "https://h1", book_title: "Book A", book_author: "Auth", book_source_url: "https://a", highlighted_at: "2026-01-02", updated: "2026-01-03" }],
        }),
      })
      .mockResolvedValueOnce({
        stdout: JSON.stringify({ next: null, results: [{ id: 2, text: "t2", book_title: "Book B" }] }),
      });

    const items = await fetchHighlights("2026-01-01T00:00:00Z");

    expect(items.map((i) => i.id)).toEqual(["h-1", "h-2"]);
    expect(items[0]).toMatchObject({ title: "Book A", author: "Auth", sourceUrl: "https://a", text: "t1", summary: "n1", createdAt: "2026-01-02", updatedAt: "2026-01-03" });
    expect(items[1].title).toBe("Book B");
    expect(mockExeca).toHaveBeenCalledTimes(2);
    const [cmd, args] = mockExeca.mock.calls[0];
    expect(cmd).toBe("readwise");
    expect(args).toContain("readwise-list-highlights");
    expect(args).toContain("--updated-gt");
  });

  it("returns [] when no token and CLI is disabled", async () => {
    process.env.READWISE_USE_CLI = "false";
    const items = await fetchHighlights("2026-01-01T00:00:00Z");
    expect(items).toEqual([]);
    expect(mockExeca).not.toHaveBeenCalled();
  });
});
