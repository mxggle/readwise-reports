import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  filterUnprocessed,
  markProcessedItems,
  openProcessedStore,
  type ProcessedStore,
} from "../src/kernel/processed-store.js";
import type { DedupItem } from "../src/kernel/types.js";

function item(id: string, title: string): DedupItem {
  return {
    id,
    title,
    url: `https://example.com/${id}`,
    source: "reader-document",
    text: `body of ${title}`,
  };
}

describe("processed-store dedup", () => {
  let dir: string;
  let store: ProcessedStore;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "rw-store-"));
    store = await openProcessedStore(path.join(dir, "test.sqlite"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("treats unseen items as fresh", async () => {
    const items = [item("a", "A"), item("b", "B")];
    const { fresh, skipped } = await filterUnprocessed(store, items, "2026-05-29");
    expect(fresh).toHaveLength(2);
    expect(skipped).toHaveLength(0);
  });

  it("keeps same-day items fresh so re-runs reproduce the report", async () => {
    const items = [item("a", "A"), item("b", "B")];
    await markProcessedItems(store, items, "2026-05-29", new Date().toISOString());

    // Second run on the SAME report date must still see them as fresh.
    const { fresh, skipped } = await filterUnprocessed(store, items, "2026-05-29");
    expect(fresh).toHaveLength(2);
    expect(skipped).toHaveLength(0);
  });

  it("skips items processed for an earlier report date (cross-day dedup)", async () => {
    const items = [item("a", "A"), item("b", "B")];
    await markProcessedItems(store, items, "2026-05-28", new Date().toISOString());

    const { fresh, skipped } = await filterUnprocessed(store, items, "2026-05-29");
    expect(fresh).toHaveLength(0);
    expect(skipped).toHaveLength(2);
  });

  it("re-marking same items keeps the original report_date", async () => {
    const items = [item("a", "A")];
    await markProcessedItems(store, items, "2026-05-28", "2026-05-28T00:00:00.000Z");
    await markProcessedItems(store, items, "2026-05-29", "2026-05-29T00:00:00.000Z");

    // INSERT OR IGNORE means the original 05-28 row wins → still skipped on 05-29.
    const { fresh, skipped } = await filterUnprocessed(store, items, "2026-05-29");
    expect(fresh).toHaveLength(0);
    expect(skipped).toHaveLength(1);
  });
});
