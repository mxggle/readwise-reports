# readwise skill — explicit Reader location scope

**Date:** 2026-06-01
**Status:** Design (approved, pending spec review)
**Scope:** `skills/readwise/` only

## Problem

`skills/readwise/index.ts` calls `fetchReaderDocuments(updatedAfter, log)` in
`lib/readwise-api.ts`, which talks to Readwise Reader either via `/api/v3/list/`
(when `READWISE_TOKEN` is set) or via `readwise reader-list-documents` (CLI
fallback). Neither path passes a `--location` / `?location=...` filter, so the
skill pulls every Reader document that was updated in the lookback window
across **all** locations (`new`, `later`, `shortlist`, `archive`, `feed`).

Verified empirically on 2026-06-01:

- `readwise reader-list-documents` with no `--location` returns items from
  multiple locations in the first page (`new`, `feed`, … mixed).
- The 2026-06-01 raw report contains 54 items: **44 from `feed`, 10 from `new`**.
- `mapReaderDoc` already maps the Reader `location` field into
  `SourceItem.location`, so the data is captured — it is just not surfaced in
  the rendered report, and the fetch scope is implicit.

The user wants two things:

1. The Reader fetch scope to be **explicit and configurable** (so that
   `feed` is opt-in — Readwise's own CLI help explicitly warns: *"'feed' =
   RSS feed items (only use when user explicitly asks about feed/RSS)"*).
2. The rendered report to **show where each item came from** so the user can
   see at a glance whether a piece is from their inbox or from a feed
   subscription.

## Goals

- Make the Reader location scope a first-class, configurable concern of the
  skill.
- Default to `["new", "feed"]` so the skill matches the user's actual reading
  mix without further configuration.
- Surface the per-item `location` value in the daily report.
- Stay strictly backwards-compatible: omitting the new config field must
  preserve today's "all locations" behavior.

## Non-goals

- Filtering by Reader `category` (article / email / rss / tweet / …).
- Changing the highlights fetch scope (`fetchHighlights` is unchanged).
- Introducing new data sources (Daily Review, semantic search, etc.).
- Changing dedup keys, classification, scoring, or the AI prompt templates.
- Reading or displaying `tags` differently based on location.

## Design

### 1. Configuration (`skills/readwise/skill.json`)

Add a new top-level `reader` block:

```json
"reader": {
  "locations": ["new", "feed"]
}
```

Rules:

- `locations` is an optional array of strings.
- Each value must be one of the Reader location names: `new`, `later`,
  `shortlist`, `archive`, `feed`. Any unknown value is **logged as a warning
  and skipped** — it must not abort the skill.
- Default (when the field is absent): `["new", "feed"]`.
- Special value `[]` (empty array) means **no filter** — preserve today's
  "fetch every location" behavior. This is the documented escape hatch for
  users who want the previous behavior.

### 2. Types

`SourceItem` already declares `location?: string` and `mapReaderDoc` already
populates it from the Reader response. **No type changes are needed.** No
new field is introduced.

### 3. Backend (`skills/readwise/lib/readwise-api.ts`)

Extend `fetchReaderDocuments` with an optional `locations` parameter:

```ts
export async function fetchReaderDocuments(
  updatedAfter: string,
  log?: WarnLog,
  locations?: string[],
): Promise<SourceItem[]>
```

Behavior:

- If `locations` is `undefined` or an empty array, behave exactly as today —
  one pass over the Reader list endpoint, paginating until exhausted.
- If `locations` is a non-empty array, run one fetch per location and merge
  the results. Within a single fetch batch, the existing
  `fetchAllPages` / per-call pagination is unchanged. Cross-batch dedup of
  the same document appearing in two locations (e.g. a user moves it
  between `new` and `later` during the window) is handled by the existing
  `dedupe()` helper plus the SQLite processed-store downstream — we do not
  add a new dedup key.

Per-location iteration:

- **API path** (`READWISE_TOKEN` set): call
  `/api/v3/list/?location=<loc>&updatedAfter=...` per location. The v3 list
  endpoint accepts repeated `location` query parameters; looping per
  location is simpler and avoids any change in pagination semantics.
- **CLI path**: call
  `readwise reader-list-documents --location <loc> --updated-after …` per
  location.

Unknown locations in the config: the skill logs a warning naming the bad
value and the list of valid locations, then drops it from the iteration
list. If every configured location is unknown, the skill still runs (with
zero Reader documents) and continues to fetch highlights — the report is
not blanked out.

### 4. Wiring (`skills/readwise/index.ts`)

Pass the new config through to the fetcher:

```ts
const readerLocations = config.reader?.locations;
const readerDocs = await fetchReaderDocuments(
  windowStart,
  log,
  Array.isArray(readerLocations) ? readerLocations : undefined,
);
```

No other changes in `index.ts`. The downstream pipeline (classify →
analyze → render) already has access to `item.location`.

### 5. Report rendering (`skills/readwise/lib/markdown.ts`)

Two small additions, both gated on the data being present:

**a) "来源分布" card in the existing grid on the 快速概览 section.**

Compute a count of items per non-empty `location` (only locations with ≥ 1
item are shown) and add a new card:

```text
:material-source-branch: **来源分布**

Feed: 12 · Inbox: 3
```

If no item carries a `location` value, the card is omitted.

**b) "位置" meta line inside each `itemBlock`.**

In the meta block for an individual item, add a line between 作者 and 链接:

```text
- **位置**: `feed`
```

Only emitted when `item.location` is a non-empty string. Mirrors the
existing "如果字段缺失就不渲染"的风格 of the file (see how `item.url` is
already handled).

The action / score / topic grouping logic is unchanged. We do **not** split
"今日重点" into "Feed 重点" / "Inbox 重点" sub-sections — that is
over-engineering for this change.

### 6. Error handling

- Reader API / CLI failure on one location: warn, skip that location's
  results, continue with the others. The existing per-call try/catch in the
  CLI path already swallows fetch errors; we extend the same pattern to the
  per-location loop rather than introducing a new error class.
- Invalid location in config: warn, skip. (See §1.)
- Empty results from a location: contributes 0 items, not an error.
- Zero Reader documents across all configured locations: report still
  renders; the 快速概览 card is omitted; highlights and AI summary still
  run.

## File-level change summary

| File | Change |
|---|---|
| `skills/readwise/skill.json` | Add `reader.locations` with default `["new", "feed"]`. |
| `skills/readwise/lib/readwise-api.ts` | `fetchReaderDocuments` gains a `locations?: string[]` param; iterate when provided. |
| `skills/readwise/index.ts` | Pass `config.reader?.locations` into `fetchReaderDocuments`. |
| `skills/readwise/lib/markdown.ts` | Add 来源分布 card and "位置" meta line in `itemBlock`. |

No changes to `_sdk/`, kernel, registry, or other skills.

## Verification

Before declaring this done:

1. `pnpm typecheck` passes.
2. `pnpm generate --skill readwise --dry-run` runs without error.
3. A real (non-dry) generation for today produces:
   - `generated/raw/readwise/<date>.json` where every reader-document item
     has a `location` value and the distribution matches the configured
     scope.
   - `docs/readwise/<date>.md` where the 快速概览 section shows a 来源分布
     card and each item's meta block includes `- **位置**: ...`.
4. Setting `reader.locations` to `[]` produces a report whose Reader item
   distribution matches the pre-change "all locations" behavior.
5. Setting `reader.locations` to `["bogus"]` logs a warning and produces a
   report with 0 Reader items but a working highlights section.

## Risks

- **Bigger pulls by default.** Today's effective scope is "all locations";
  the new default drops `later`, `shortlist`, and `archive`. If the user has
  habitually relied on those appearing in the report, they will go silent.
  Mitigation: the `[]` escape hatch restores the old behavior with one
  config change. Document this in the in-line comment in `skill.json`.
- **Per-location fetch multiplies API requests.** With the default
  `["new", "feed"]` the count doubles for Reader, but each call is already
  paginated and rate-limit-aware (see `MAX_PAGES` and the 429 backoff in
  `readwise-api.ts`). The CLI path is also bounded by `MAX_PAGES`. No
  additional rate-limit handling is introduced here.
