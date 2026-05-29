import { describe, expect, it } from "vitest";
import { parseRSSItems } from "../../skills/hn/lib/feeds.js";

describe("parseRSSItems", () => {
  it("parses RSS 2.0 items, stripping HTML from title/description", () => {
    const xml = `<?xml version="1.0"?>
<rss version="2.0"><channel>
  <item>
    <title><![CDATA[Hello <b>World</b>]]></title>
    <link>https://example.com/a</link>
    <pubDate>Tue, 27 May 2026 10:00:00 GMT</pubDate>
    <description><![CDATA[<p>Some &amp; body</p>]]></description>
  </item>
</channel></rss>`;
    const items = parseRSSItems(xml);
    expect(items).toHaveLength(1);
    expect(items[0].title).toBe("Hello World");
    expect(items[0].link).toBe("https://example.com/a");
    expect(items[0].description).toBe("Some & body");
  });

  it("parses Atom entries and prefers the alternate link", () => {
    const xml = `<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <title>Atom Post</title>
    <link rel="alternate" href="https://example.com/atom"/>
    <published>2026-05-27T10:00:00Z</published>
    <summary>An atom summary</summary>
  </entry>
</feed>`;
    const items = parseRSSItems(xml);
    expect(items).toHaveLength(1);
    expect(items[0].title).toBe("Atom Post");
    expect(items[0].link).toBe("https://example.com/atom");
    expect(items[0].description).toBe("An atom summary");
  });

  it("falls back to guid when an item has no link", () => {
    const xml = `<rss><channel><item>
      <title>No Link</title>
      <guid>https://example.com/guid</guid>
    </item></channel></rss>`;
    const items = parseRSSItems(xml);
    expect(items[0].link).toBe("https://example.com/guid");
  });
});
