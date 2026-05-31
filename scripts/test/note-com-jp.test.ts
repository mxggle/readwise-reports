import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { SkillManifestSchema } from "../src/kernel/types.js";
import { rankCandidates } from "../../skills/note-com-jp/lib/select.js";
import { htmlToMarkdown } from "../../skills/note-com-jp/lib/notecom.js";
import type { RawNote } from "../../skills/note-com-jp/lib/types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function makeNote(over: Partial<RawNote> & { key: string }): RawNote {
  return {
    title: `note ${over.key}`,
    authorName: "author",
    authorUrlname: "author",
    likeCount: 0,
    publishAt: "2026-05-31T11:00:00.000+09:00",
    price: 0,
    canReadAll: true,
    url: `https://note.com/author/n/${over.key}`,
    hashtags: ["生成AI"],
    ...over,
  };
}

describe("note-com-jp manifest", () => {
  it("parses skill.json with the expected dedup/digest/schedule config", () => {
    const raw = readFileSync(path.join(__dirname, "..", "..", "skills", "note-com-jp", "skill.json"), "utf8");
    const parsed = SkillManifestSchema.parse(JSON.parse(raw));
    expect(parsed.id).toBe("note-com-jp");
    expect(parsed.ai.provider).toBe("deepseek");
    expect(parsed.ai.outputLanguage).toBe("zh-CN");
    expect(parsed.schedule.lookbackHours).toBe(24);
    expect(parsed.digest.maxItems).toBe(5);
    expect(parsed.dedup.enabled).toBe(true);
    expect(parsed.dedup.keyField).toBe("id");
  });
});

describe("rankCandidates", () => {
  // Fixed reference time: 2026-05-31 12:00 UTC.
  const now = new Date("2026-05-31T12:00:00.000Z");
  const lookbackHours = 24;
  const inWindow = "2026-05-31T19:00:00.000+09:00"; // 10:00 UTC, 2h ago
  const tooOld = "2026-05-30T10:00:00.000+09:00"; //  ~25h+ ago

  it("keeps free + in-window notes and sorts by like count desc", () => {
    const notes = [
      makeNote({ key: "a", likeCount: 10, publishAt: inWindow }),
      makeNote({ key: "e", likeCount: 5, publishAt: inWindow }),
      makeNote({ key: "old", likeCount: 100, publishAt: tooOld }),
      makeNote({ key: "paid", likeCount: 50, publishAt: inWindow, price: 300 }),
      makeNote({ key: "locked", likeCount: 40, publishAt: inWindow, canReadAll: false }),
    ];
    const ranked = rankCandidates({ notes, now, lookbackHours });
    expect(ranked.map((n) => n.key)).toEqual(["a", "e"]);
  });

  it("dedups by key, unioning hashtags and keeping the max like count", () => {
    const notes = [
      makeNote({ key: "a", likeCount: 8, hashtags: ["生成AI"], publishAt: inWindow }),
      makeNote({ key: "a", likeCount: 12, hashtags: ["LLM"], publishAt: inWindow }),
    ];
    const ranked = rankCandidates({ notes, now, lookbackHours });
    expect(ranked).toHaveLength(1);
    expect(ranked[0].likeCount).toBe(12);
    expect([...ranked[0].hashtags].sort()).toEqual(["LLM", "生成AI"]);
  });

  it("excludes notes published in the future beyond the skew tolerance", () => {
    const future = "2026-06-01T12:00:00.000Z"; // +24h
    const ranked = rankCandidates({ notes: [makeNote({ key: "f", publishAt: future })], now, lookbackHours });
    expect(ranked).toHaveLength(0);
  });
});

describe("htmlToMarkdown", () => {
  it("converts note body HTML blocks into markdown", () => {
    const html =
      '<h2>見出し</h2><p>これは<strong>太字</strong>と<a href="https://x.com">リンク</a>。</p>' +
      "<ul><li>項目1</li><li>項目2</li></ul>" +
      '<figure><img src="https://img/1.png" alt="図"><figcaption>説明</figcaption></figure>';
    const md = htmlToMarkdown(html);
    expect(md).toContain("### 見出し");
    expect(md).toContain("**太字**");
    expect(md).toContain("[リンク](https://x.com)");
    expect(md).toContain("- 項目1");
    expect(md).toContain("- 項目2");
    expect(md).toContain("![図](https://img/1.png)");
    expect(md).toContain("*説明*");
  });

  it("decodes HTML entities and strips unknown tags", () => {
    expect(htmlToMarkdown("<p>A &amp; B &lt;tag&gt;</p>")).toContain("A & B <tag>");
    expect(htmlToMarkdown('<div class="x"><span>plain</span></div>')).toContain("plain");
  });

  it("returns empty string for empty input", () => {
    expect(htmlToMarkdown("")).toBe("");
  });
});
