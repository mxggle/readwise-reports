# CLAUDE.md — readwise-reports

Project context and conventions for Claude Code working in this repository.

---

## What this project does

Daily report pipeline. Each **Skill** (`skills/{id}/`) is an isolated plugin that:

1. Fetches content from a data source
2. Deduplicates against a local SQLite store
3. Calls an AI model to summarise / score / classify
4. Writes a Markdown report to `docs/{id}/{date}.md`
5. Returns `SkillResult` with notification payloads

The **Kernel** (`scripts/src/kernel/`) orchestrates all of the above without knowing anything about individual Skills.

---

## Repository map

```
scripts/src/
  cli.ts                   # CLI entry point (Commander)
  publish-daily.ts         # Full pipeline: generate → index → push → notify
  kernel/
    types.ts               # All shared interfaces and Zod schemas
    registry.ts            # Discovers skills/ at startup
    runtime.ts             # Builds SkillContext, dynamically imports skill index.ts
    env.ts                 # Reads and validates environment variables
    date.ts                # Date formatting helpers
    processed-store.ts     # SQLite dedup logic
    services/
      ai.ts                # AIClient factory (OpenAI, Gemini, agent-mode)
      store.ts             # SkillStore adapter over processed-store
      writer.ts            # SkillWriter (docs/ + generated/raw/)
      logger.ts            # Console logger with skill-id prefix

skills/
  _sdk/index.ts            # Re-exports kernel types for skills to import
  readwise/                # Readwise highlights + Reader documents
  hn/                      # HackerNews digest from 90 RSS feeds

docs/                      # Generated Markdown reports (committed — published source of truth)
generated/raw/             # Generated JSON snapshots (local build artifact, gitignored)
generated/readwise-processed.sqlite   # Dedup state (local, gitignored)
```

---

## The Skill contract

A Skill **must**:
- Have `skills/{id}/skill.json` with `id` matching the folder name
- Export `default async function run(ctx: SkillContext): Promise<SkillResult>` from `skills/{id}/index.ts`
- Import types only from `../_sdk/index.js` — never from `../../scripts/`
- Return `{ itemsProcessed, itemsSkipped }` at minimum

A Skill **must not**:
- Import from another Skill
- Call `process.exit()`
- Throw on zero items (return `{ itemsProcessed: 0, itemsSkipped: 0 }` instead)
- Write files outside `ctx.paths.outputDir` and `ctx.paths.rawDir`

### `SkillContext` services

| Property | Type | Use |
|---|---|---|
| `ctx.ai` | `AIClient` | `await ctx.ai.complete(prompt, opts?)` |
| `ctx.writer` | `SkillWriter` | `writeReport(markdown)`, `writeRaw(json)` |
| `ctx.store` | `SkillStore` | `filterUnprocessed(items)`, `markProcessed(items)` |
| `ctx.log` | `Logger` | `info / warn / error / debug` |
| `ctx.config` | `SkillManifest` | Parsed `skill.json` |
| `ctx.dryRun` | `boolean` | If true, store writes are skipped |
| `ctx.date` | `string` | Report date (`YYYY-MM-DD`) |

---

## Adding a new Skill — checklist

- [ ] Create `skills/{id}/skill.json` (copy from an existing one and adjust)
- [ ] Create `skills/{id}/index.ts` with a `default` export
- [ ] Import types from `../_sdk/index.js` only
- [ ] Add any required env vars to `skill.json → env.required`
- [ ] Test: `pnpm generate --skill {id} --dry-run`
- [ ] Confirm: `pnpm generate --list` shows `[ready]`
- [ ] `pnpm typecheck` passes

---

## Conventions

- **No cross-skill imports.** Skills are fully isolated.
- **Prompt templates** go in `skills/{id}/prompts/{name}.{lang}.md`. Load them with `fs.readFile`.
- **Immutability.** Never mutate items fetched from an API; map to new objects.
- **Error handling in skills.** Catch AI errors and fall back to a text summary — do not let an AI failure abort the whole skill.
- **`_sdk/`** is read-only. Changes to types go in `scripts/src/kernel/types.ts`; `_sdk/index.ts` just re-exports.
- **Folder names starting with `_`** are skipped by the Registry. Use `_sdk`, `_lib`, etc. for shared non-skill code.

---

## Environment variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `READWISE_TOKEN` | no | — | Readwise API token. Without it the readwise skill falls back to the local `readwise` CLI. |
| `READWISE_USE_CLI` | no | `true` | Set `false` to disable the CLI fallback. |
| `OPENAI_API_KEY` | at least one AI key (for api mode) | — | OpenAI |
| `GEMINI_API_KEY` | at least one AI key (for api mode) | — | Google Gemini |
| `DEEPSEEK_API_KEY` | at least one AI key (for api mode) | — | DeepSeek |
| `ANTHROPIC_API_KEY` | at least one AI key (for api mode) | — | Anthropic |
| `AI_MODE` | no | — | `api` / `agent` / `auto` — overrides every skill's `ai.mode`. `publish:daily` defaults to `api`. |
| `DISCORD_WEBHOOK_URL` | for notifications | — | Discord incoming webhook |
| `PUBLIC_SITE_URL` | for notification links | — | Deployed site base URL |
| `REPORT_TIMEZONE` | no | `Asia/Tokyo` | Timezone for date labels |
| `READWISE_PROCESSED_DB` | no | `generated/readwise-processed.sqlite` | SQLite path |

---

## AI service modes

A Skill's AI calls (`ctx.ai.complete`) are routed by `skill.json → ai.mode`:

| `ai.mode` | Behaviour |
|---|---|
| `api` | Call a provider directly with an API key (`OPENAI_API_KEY` / `GEMINI_API_KEY` / `DEEPSEEK_API_KEY` / `ANTHROPIC_API_KEY`). Falls back to any other provider with a key if the preferred one fails; the configured `model` applies only to the preferred provider. |
| `agent` | Hand the completion to an out-of-process **watcher** via a file queue (`generated/agent-tasks/` → `generated/agent-results/`). No key needed *in the skill*. |
| `auto` (default) | Pick `agent` when running inside a host agent, else `api`. Detection: `AGENT_AI=1`, `CLAUDECODE=1`, `AI_AGENT`, or `CLAUDE_AGENT_ID`. |

**Operator override:** a valid `AI_MODE` env var (`api` / `agent` / `auto`) overrides every skill's `ai.mode`. Use `AI_MODE=api` for automated/cron runs so a job launched from inside a host agent never resolves to `agent` and blocks on a watcher. `pnpm publish:daily` defaults `AI_MODE` to `api` for exactly this reason (set it explicitly to opt out).

There are **two** ways to fulfil `agent`-mode tasks — pick one, never run both:

1. **External provider watcher** — `pnpm watcher`. A separate Node process reads tasks and calls a provider with **its own** API key (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, …). The host agent's model is *not* used.
2. **Host-agent watcher** — the agent running this repo (Claude Code, Hermes, …) fulfils tasks with **its own model, no API key**:
   ```bash
   pnpm generate --skill <id>        # run in the background; it writes tasks and polls
   pnpm agent:tasks list             # see pending tasks (--json for machine-readable)
   pnpm agent:tasks resolve <taskId> --text "<completion>"   # or --file / --error
   ```
   The agent reads each task's prompt, generates the answer itself, and resolves it. Repeat until the `generate` process exits. This is what "use the running agent's AI" means — there is no hidden bridge to the host's API.

> If `ai.mode` is `agent` (or `auto` resolves to it) and **no** watcher of either kind is draining tasks, `ctx.ai.complete` blocks and times out after 10 minutes.

---

## Testing

```bash
pnpm test          # Vitest unit tests
pnpm typecheck     # tsc --noEmit
```

Tests live in `scripts/test/`. The three baseline suites cover:
- `ai-agent.test.ts` — AI client factory
- `manifest-schema.test.ts` — Zod schema validation
- `registry.test.ts` — Skill discovery

When adding a new Skill, add at least one test for its manifest parsing and one for its core data-transformation logic in `skills/{id}/lib/`.

---

## What NOT to change without understanding the impact

| File | Why it's sensitive |
|---|---|
| `scripts/src/kernel/types.ts` | `SkillContext`, `SkillResult`, `SkillManifest` — all skills depend on these |
| `scripts/src/kernel/registry.ts` | Folder-scanning logic; skip rules (`_`, `.`) are load-bearing |
| `scripts/src/kernel/runtime.ts` | Builds the context every skill receives |
| `skills/_sdk/index.ts` | Skills' only import path to the kernel |
| `generated/readwise-processed.sqlite` | Dedup state — modifying it changes what gets re-processed |

---

## Common tasks

**Run one skill in dry-run mode**
```bash
pnpm generate --skill readwise --dry-run
```

**See what skills are available and their status**
```bash
pnpm generate --list
```

**Rebuild dedup state from raw files**
```bash
pnpm backfill:processed
```

**Full publish pipeline (generates + pushes + notifies)**
```bash
pnpm publish:daily
```
