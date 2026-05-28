import { execa } from "execa";
import { env } from "../../../scripts/src/kernel/env.js";
import type { SourceItem } from "./types.js";

async function readwiseApi(path: string) {
  if (!env.readwiseToken) throw new Error("READWISE_TOKEN missing");
  const res = await fetch(`https://readwise.io${path}`, {
    headers: { Authorization: `Token ${env.readwiseToken}` },
  });
  if (!res.ok) throw new Error(`Readwise API ${res.status}: ${await res.text()}`);
  return res.json();
}

export async function fetchHighlights(updatedAfter: string): Promise<SourceItem[]> {
  if (env.readwiseToken) {
    const data = await readwiseApi(`/api/v2/export/?updatedAfter=${encodeURIComponent(updatedAfter)}`);
    const books = Array.isArray(data.results) ? data.results : data;
    const items: SourceItem[] = [];
    for (const book of books || []) {
      for (const h of book.highlights || []) {
        items.push({
          id: `h-${h.id}`,
          title: book.title || "Untitled highlight",
          author: book.author,
          url: h.url || book.source_url,
          sourceUrl: book.source_url,
          source: "readwise-highlight",
          text: h.text || "",
          summary: h.note || undefined,
          createdAt: h.created_at,
          updatedAt: h.updated_at,
          tags: [...(book.tags || []), ...(h.tags || [])].map((t: any) => typeof t === "string" ? t : t.name).filter(Boolean),
        });
      }
    }
    return items;
  }
  return [];
}

export async function fetchReaderDocuments(updatedAfter: string): Promise<SourceItem[]> {
  const fields = "title,author,source,category,location,tags,site_name,word_count,reading_time,created_at,updated_at,published_date,summary,url,source_url,saved_at";
  if (env.readwiseToken) {
    const data = await readwiseApi(`/api/v3/list/?updatedAfter=${encodeURIComponent(updatedAfter)}`);
    const results = data.results || [];
    return results.map((d: any) => ({
      id: `r-${d.id}`,
      title: d.title || "Untitled Reader document",
      author: d.author,
      url: d.url || `https://read.readwise.io/read/${d.id}`,
      sourceUrl: d.source_url,
      source: "reader-document" as const,
      category: d.category,
      location: d.location,
      text: d.content || d.summary || "",
      summary: d.summary,
      createdAt: d.created_at || d.saved_at,
      updatedAt: d.updated_at,
      publishedDate: d.published_date,
      tags: Object.keys(d.tags || {}),
      wordCount: d.word_count,
    }));
  }

  if (!env.readwiseUseCli) return [];
  try {
    const { stdout } = await execa("readwise", [
      "reader-list-documents",
      "--updated-after", updatedAfter,
      "--limit", "100",
      "--response-fields", fields,
      "--json",
    ]);
    const data = JSON.parse(stdout);
    return (data.results || []).map((d: any) => ({
      id: `r-${d.id}`,
      title: d.title || "Untitled Reader document",
      author: d.author,
      url: d.url || `https://read.readwise.io/read/${d.id}`,
      sourceUrl: d.source_url,
      source: "reader-document" as const,
      category: d.category,
      location: d.location,
      text: d.summary || "",
      summary: d.summary,
      createdAt: d.created_at || d.saved_at,
      updatedAt: d.updated_at,
      publishedDate: d.published_date,
      tags: Object.keys(d.tags || {}),
      wordCount: d.word_count,
    }));
  } catch (error) {
    console.warn("Reader CLI fetch failed:", error instanceof Error ? error.message : error);
    return [];
  }
}

export function dedupe(items: SourceItem[]) {
  const seen = new Set<string>();
  const out: SourceItem[] = [];
  for (const item of items) {
    const key = `${item.title.toLowerCase().trim()}|${item.author || ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}
