import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { env } from "./lib/env.js";
import { markProcessedItems, openProcessedStore } from "./lib/processed-store.js";
import type { ReportData } from "./lib/types.js";

const rawDir = path.join("generated", "raw");
const files = (await readdir(rawDir)).filter((file) => file.endsWith(".json")).sort();
const store = await openProcessedStore(env.processedDbPath);
let total = 0;

for (const file of files) {
  const fullPath = path.join(rawDir, file);
  const data = JSON.parse(await readFile(fullPath, "utf8")) as ReportData;
  const reportDate = data.date || file.replace(/\.json$/, "");
  await markProcessedItems(store, data.items, reportDate, data.generatedAt || new Date().toISOString());
  total += data.items.length;
  console.log(`Backfilled ${data.items.length} items from ${file}`);
}

console.log(`Backfill complete: ${total} historical report items recorded in ${env.processedDbPath}`);
