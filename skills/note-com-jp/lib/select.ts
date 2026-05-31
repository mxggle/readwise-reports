import type { RawNote } from "./types.js";

// Merge notes that appeared under multiple hashtags into one entry, keeping the
// richest metadata and the union of tags. Pure — no I/O — so it is unit-tested.
function dedupByKey(notes: RawNote[]): RawNote[] {
  const byKey = new Map<string, RawNote>();
  for (const note of notes) {
    const existing = byKey.get(note.key);
    if (!existing) {
      byKey.set(note.key, { ...note, hashtags: [...note.hashtags] });
      continue;
    }
    const tags = new Set([...existing.hashtags, ...note.hashtags]);
    byKey.set(note.key, {
      ...existing,
      likeCount: Math.max(existing.likeCount, note.likeCount),
      hashtags: [...tags],
    });
  }
  return [...byKey.values()];
}

function withinWindow(publishAt: string, now: Date, lookbackHours: number): boolean {
  const ts = new Date(publishAt).getTime();
  if (Number.isNaN(ts)) return false;
  const ageMs = now.getTime() - ts;
  const windowMs = lookbackHours * 60 * 60 * 1000;
  // Keep notes published within the window. Allow a small future skew (clock /
  // timezone drift) so a just-published note is not dropped.
  return ageMs <= windowMs && ageMs >= -10 * 60 * 1000;
}

export interface SelectParams {
  notes: RawNote[];
  now: Date;
  lookbackHours: number;
}

// Produce the ranked candidate list: deduped, free + fully readable, published
// within the lookback window, sorted by like count (desc). Cross-day dedup
// against the processed store happens in index.ts, after this.
export function rankCandidates({ notes, now, lookbackHours }: SelectParams): RawNote[] {
  return dedupByKey(notes)
    .filter((n) => n.price === 0 && n.canReadAll)
    .filter((n) => withinWindow(n.publishAt, now, lookbackHours))
    .sort((a, b) => b.likeCount - a.likeCount);
}
