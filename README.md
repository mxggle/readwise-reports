# Readwise Reports

本项目是一个本地文件化的 Readwise 自动日报系统：

- 获取 Readwise highlights 和 Reader 当天新增/更新内容
- 自动分类：AI / Programming / Japanese / English / Career / Business / Other
- 生成漂亮 Markdown 日报
- 用本地 SQLite 账本记录已处理内容，避免 Reader/Redirect 未归档导致日报重复
- 更新 MkDocs Material 站点索引
- GitHub Actions 自动部署 GitHub Pages
- Discord 只发送摘要和网页链接，不发送长正文

## 快速开始

```bash
cd ~/readwise-reports
cp .env.example .env
pnpm install
python3 -m pip install -r requirements.txt
pnpm generate
pnpm docs:serve
```

打开本地文档：<http://127.0.0.1:8000>

## 配置

编辑 `.env`：

```bash
READWISE_TOKEN=...
DISCORD_WEBHOOK_URL=...
PUBLIC_SITE_URL=https://<user>.github.io/readwise-reports
OPENAI_API_KEY=... # 可选
GEMINI_API_KEY=... # 可选
```

如果没有 `READWISE_TOKEN`，脚本会尝试使用已登录的本地 `readwise` CLI。

## 常用命令

```bash
pnpm generate          # 生成今天日报
pnpm dev               # dry-run，不通知 Discord，也不写入去重账本
pnpm backfill:processed # 从 generated/raw/*.json 回填 SQLite 去重账本
pnpm build:index       # 重新生成索引
pnpm docs:build        # 构建 MkDocs 站点
pnpm docs:serve        # 本地预览
```

## 去重账本

日报会把成功处理过的内容写入本地 SQLite：

```text
generated/readwise-processed.sqlite
```

去重判断顺序：

1. `item_id`，例如 Reader document id / Readwise highlight id
2. 规范化后的 `url`
3. `title + author + url + text/summary` 生成的 `content_hash`

这样即使 Reader/Redirect 里没有归档、标已读或删除，第二天再次拉到同一条内容也会跳过。

可用 `.env` 覆盖数据库位置：

```bash
READWISE_PROCESSED_DB=generated/readwise-processed.sqlite
```

## GitHub Pages

当前推荐架构：**本地 cron 生成报告并 push，GitHub Actions 只负责部署 Pages**。

原因：本地已经登录 Readwise CLI，不需要把 Readwise OAuth 状态搬到 GitHub Actions。GitHub 只托管静态站点，职责更干净。

已配置的项目 Pages 地址：

```text
https://mxggle.github.io/readwise-reports/
```

GitHub Actions 会在 `main` 分支 push 后自动构建 MkDocs 并部署 GitHub Pages。

如果以后想改成 GitHub Actions 也负责生成报告，需要在仓库 Secrets 里配置：

- `READWISE_TOKEN`
- `DISCORD_WEBHOOK_URL`
- `PUBLIC_SITE_URL`
- `OPENAI_API_KEY` 或 `GEMINI_API_KEY`，可选

## 输出结构

```text
readwise-reports/
  docs/
    index.md
    daily/
    weekly/
    monthly/
    topics/
  scripts/
  generated/
  .github/workflows/
```

## 设计原则

- Discord 是入口，不是知识库。
- Markdown 是长期资产。
- SQLite 只保存自动化状态，报告正文仍保持文件化、可 grep、可 git diff、可迁移。
- 小而稳定，避免自动化变成第二份工作。
