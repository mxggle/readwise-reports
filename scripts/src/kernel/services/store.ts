import {
  filterUnprocessed,
  markProcessedItems,
  openProcessedStore,
  type ProcessedStore,
} from "../processed-store.js";
import type { DedupItem, SkillStore } from "../types.js";

export function buildStore(dbPath: string, date: string, dryRun: boolean): SkillStore {
  let storePromise: Promise<ProcessedStore> | null = null;
  const getStore = () => (storePromise ??= openProcessedStore(dbPath));

  return {
    filterUnprocessed: async <T extends DedupItem>(items: T[]) =>
      filterUnprocessed(await getStore(), items, date),
    markProcessed: async <T extends DedupItem>(items: T[]) => {
      if (dryRun) return;
      const now = new Date().toISOString();
      await markProcessedItems(await getStore(), items, date, now);
    },
  };
}
