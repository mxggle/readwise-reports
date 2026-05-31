# Skill 管理面板（本地后端） — 设计文档

- 日期：2026-05-31
- 状态：待实现（设计已与用户确认）
- 范围：在本仓库内新增一个**本地**后端服务 + 单页前端，用界面管理 `skills/`（列出 / 启停 / 运行 / 新建 / 导入）。无 AI、无云、无 pi agent。

---

## 1. 背景与目标

本仓库是「每日报告」流水线：每个 Skill (`skills/{id}/`) 是隔离插件，由 kernel (`scripts/src/kernel/`) 编排，产出 `docs/{id}/{date}.md`，最终 `mkdocs build` 成静态站发布。

目前所有 Skill 操作都走命令行（`pnpm generate --list`、`--skill X --dry-run` 等）。目标：把这些操作做成一个**本地图形界面**，降低操作成本，同时不改动现有发布链路。

**核心定位（两层、互不干扰）：**

```
① 已发布静态站（不变）
   docs/ ──mkdocs build──> site/ ──> Pages（纯静态 / 只读 / 公开）

② 新增本地管理后台（本设计）
   浏览器(localhost) ⇄ Node 进程(pnpm panel) ⇄ kernel + skills/ 文件
   可读写 / 私有 / 仅本机
```

管理后台是**触发与管理工具**，静态站是**产物**。后台进程只能管理它所在机器上的这份仓库。

## 2. Non-Goals（明确不做）

- ❌ AI 辅助写 Skill 逻辑（「描述一句话→生成代码」）。需要时直接用正在跑的 host agent（Hermes/Claude Code），不引入 pi。
- ❌ 公网部署 / 多用户 / 部署到 Vercel（serverless 文件系统临时只读，写后端跑不了）。仅本地；远程需求用 SSH 隧道到仓库所在机器。
- ❌ 浏览器内代码编辑器。新建只生成骨架，代码在用户自己的编辑器里写。
- ❌ 自动把新 Skill 的日报写进 mkdocs 的 `nav`（nav 目前是手维护的，属发布流程，另议）。
- ❌ git URL 导入（列为 fast-follow）。

## 3. 技术选型（最佳实践）

| 关注点 | 选择 | 理由 |
|---|---|---|
| 后端框架 | **Hono** + `@hono/node-server` | 极小、零臃肿、TS 一等公民，自带路由 / 静态托管 / SSE helper / multipart。裸 `node:http` 手搓 multipart+SSE+路由 = 重造易错轮子。 |
| 校验 | **复用仓库已有 `zod` + `SkillManifestSchema`** | manifest 是 `.strict()`，id 正则等规则只此一处，不重写。 |
| 前端 | 单页 `panel/index.html` + 原生 JS（`fetch` + `EventSource`），**无构建步骤** | 个人本地工具，不值得引入前端构建链；需要组件化再上 Vite。 |
| 运行时 | `tsx`（与现有 scripts 一致） | 不引入新运行方式。 |
| 进程模型 | 运行 Skill = **spawn 现有 CLI 子进程** | 隔离 skill 崩溃 / `process.exit`；白拿 env 校验与 agent 模式提示；可 kill。 |

新增依赖仅 `hono` + `@hono/node-server`（轻、无重型传递依赖）。

## 4. 复用现有代码（不重造）

| 能力 | 复用 |
|---|---|
| 列出 Skill | `loadRegistry()` → `SkillEntry[]` |
| 查找 Skill | `findSkill(entries, id)` |
| 运行 Skill | spawn `tsx scripts/src/cli.ts --skill <id> [--dry-run]` |
| manifest 校验 / id 规则 | `SkillManifestSchema`（`scripts/src/kernel/types.ts`） |
| 状态判断(ready/disabled/缺env) | **抽取** 见 §6.1 |

## 5. 模块 / 文件布局（多小文件，职责单一）

```
scripts/src/server/
  server.ts            # 入口：pnpm panel；绑 127.0.0.1；打印 token + URL
  app.ts               # Hono app 装配（路由挂载、中间件、静态托管、错误封装）
  middleware/
    origin-guard.ts    # Origin/Host 白名单（防 CSRF / DNS-rebinding）
    token-guard.ts     # 写操作校验 X-Panel-Token
  routes/
    skills.ts          # 列表 / 详情 / 启停 / 新建 / 删除
    import.ts          # 导入（文件夹 / zip）
    runs.ts            # 触发运行 + SSE 日志 + 取消
    reports.ts         # 读取 docs/{id}/*.md
  services/
    status.ts          # describeSkillStatus()（与 CLI 共用）
    scaffold.ts        # 从模板生成 skills/{id}/
    importer.ts        # 解压 + zip-slip 防护 + 校验 + 落地
    runner.ts          # 子进程管理：start/stream/cancel，单 skill 单运行
    trash.ts           # 删除 → .trash/{ts}-{id}/
  templates/skill/     # 起手式模板（skill.json + index.ts + prompts/ + 最小测试）
  http.ts              # ApiResponse<T> 封装 + 错误→响应映射
panel/
  index.html           # 单页前端（server 注入 per-boot token）
  app.js
  styles.css
specs/2026-05-31-skill-admin-panel-design.md   # 本文档
```

`package.json` 增脚本：`"panel": "tsx scripts/src/server/server.ts"`。

## 6. 关键行为

### 6.1 抽取状态函数（重构）
当前 `cli.ts:34-38` 内联计算 `ready / disabled / missing env`。抽成 `kernel/status.ts`：

```ts
export type SkillStatus =
  | { kind: "ready" }
  | { kind: "disabled" }
  | { kind: "missing-env"; missing: string[] };

export function describeSkillStatus(entry: SkillEntry, env = process.env): SkillStatus;
```

`cli.ts` 与面板 `routes/skills.ts` 同时调用，避免逻辑漂移。

### 6.2 运行（子进程 + SSE）
- `POST /api/skills/:id/run`：body `{ dryRun: boolean, date?: string }` → spawn `tsx scripts/src/cli.ts --skill <id> [--dry-run] [--date ...]`，注入 `AI_MODE=api`（避免 agent 模式阻塞等 watcher），返回 `runId`。
- `GET /api/runs/:runId/stream`：SSE，逐行推 stdout/stderr，结束推 `exit` 事件含退出码。
- `DELETE /api/runs/:runId`：kill 子进程。
- `runner` 维护 `Map<skillId, RunState>`，同一 skill 已有 in-flight 运行时拒绝新运行（409）。

### 6.3 新建（scaffold）
- `POST /api/skills`：body `{ id, title, ... }` → 先用 `SkillManifestSchema.parse` 校验拼出的 manifest；id 已存在 → 409。
- 从 `templates/skill/` 拷贝并填充占位符，生成：`skill.json`、`index.ts`（可跑的 no-op：返回 `{itemsProcessed:0,itemsSkipped:0}`）、`prompts/.gitkeep`、`lib/.gitkeep`、`skills/{id}/__tests__` 或对应 `scripts/test` 的最小 manifest 测试（遵循 `CLAUDE.md` 的新增清单）。
- 生成后骨架须开箱即过 `pnpm typecheck` 与 `pnpm generate --skill {id} --dry-run`。
- 响应含「在编辑器打开」提示（前端按钮可触发 `$EDITOR`/`code skills/{id}`，作为可选增强）。

### 6.4 导入（文件夹 / zip）
- `POST /api/skills/import`：`{ kind: "folder", path }` 或 `multipart` 上传 zip。
- 流程：解到**临时目录** → **zip-slip / 路径穿越防护**（拒绝跳出目标根的条目）→ 定位含 `skill.json` 的目录 → `SkillManifestSchema.parse` → 校验 `manifest.id === 文件夹名` → 与现有冲突则 409 → 通过后移动进 `skills/`。
- 任何一步失败 → 清理临时目录，返回明确错误。

### 6.5 启停 / 删除
- `PATCH /api/skills/:id`：`{ enabled }` → 读 `skill.json`、**不可变更新**（生成新对象再写）翻转 `enabled` 字段。kernel 本就认 `enabled !== false`，无需新机制。
- `DELETE /api/skills/:id`：移动 `skills/{id}/` 到 `.trash/{timestamp}-{id}/`（不硬删）。`.trash/` 加入 `.gitignore`。

## 7. API 约定

统一封装（遵循用户 TS 规则的 `ApiResponse<T>`）：

```ts
type ApiResponse<T> = { success: true; data: T } | { success: false; error: string };
```

| Method | Path | 说明 | 写? |
|---|---|---|---|
| GET | `/api/skills` | 列表 + 状态 + 最近日报日期 | |
| GET | `/api/skills/:id` | manifest + 文件清单 + 历史日报列表 | |
| POST | `/api/skills` | 新建（scaffold） | ✅ |
| PATCH | `/api/skills/:id` | 启停 | ✅ |
| DELETE | `/api/skills/:id` | 删除→回收站 | ✅ |
| POST | `/api/skills/import` | 导入（folder/zip） | ✅ |
| POST | `/api/skills/:id/run` | 触发运行 → `{runId}` | ✅ |
| GET | `/api/runs/:runId/stream` | SSE 日志 | |
| DELETE | `/api/runs/:runId` | 取消运行 | ✅ |
| GET | `/api/skills/:id/report?date=` | 读取某日报告 markdown | |

## 8. 安全模型（本地也要做）

能跑 shell 的后端，即便只绑本机，恶意网页仍可经 DNS-rebinding / CSRF 打 `localhost:端口`。

1. **仅绑 `127.0.0.1`**，默认端口 `PANEL_PORT`（默认 `4319`）。
2. **Origin/Host 白名单**：非 `127.0.0.1`/`localhost` 的 Origin/Host 一律拒。
3. **per-boot token**：启动生成随机 token，注入到 `index.html`；所有**写操作**须带 `X-Panel-Token`。
4. 所有输入 zod 校验；id 强制走 `SkillManifestSchema` 的正则，防路径穿越。
5. 删除走回收站；导入做 zip-slip 防护。

## 9. 测试策略（按工具性质裁剪，不盲目套 80%）

- **单测（重点）**：`status.ts`、`scaffold.ts`、`importer.ts`（含 zip-slip 用例）、manifest 校验失败路径。
- **集成**：用 Hono 的 `app.request()` 测主要路由（list / create 冲突 / enable 切换 / import 拒绝非法 zip / run 返回 runId）。
- **E2E**：Playwright 对个人本地面板属过度，**暂不做**（列为可选）。
- 说明：这是按「个人本地工具」比例裁剪，覆盖风险逻辑而非追求统一覆盖率数字。

## 10. 未来 / 可选（不在本期）

- git URL 导入。
- AI 辅助创作（host agent 或 pi/Claude Agent SDK）。
- 新 Skill 日报自动并入 mkdocs `nav`（发布流程改造）。
- 浏览器内编辑代码。

## 11. 待定

- 默认端口是否 `4319`（可改）。
- token 是否需要持久化（默认 per-boot 即可）。
