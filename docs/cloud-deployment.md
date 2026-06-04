# Cloud Deployment

本文档说明 Phase 1 云端数据层和 cron-job.org 每日简报触发。云端版只生成每日编辑简报，不写文章、不生成封面、不写微信公众号草稿、不发布、不群发。

## 架构

- Vercel：Next.js Dashboard / API。
- Neon：结构化数据。
- Cloudflare R2：文件对象。
- cron-job.org：每天 7 点触发生成简报。

流程：

```text
cron-job.org
→ POST https://你的域名/api/cron/generate-brief
→ Vercel API 运行简报生成
→ Neon 保存 runs / news_items / shortlisted_items / editorial_briefs
→ R2 保存 reports/{runDate}/editorial-brief.md
→ /brief 通过 GET /api/brief/today 读取今日简报
```

## 环境变量

在 Vercel Project Settings 中配置：

```env
DATABASE_URL=
DATABASE_MAX_CONNECTIONS=1
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET=
R2_PUBLIC_BASE_URL=
CRON_SECRET=
DASHBOARD_PASSWORD=
AUTH_SECRET=
BRIEF_TIME_ZONE=Asia/Shanghai
```

说明：

- `DATABASE_URL` 使用 Neon Postgres 连接串。
- `R2_ACCOUNT_ID` 必须填写 Cloudflare 账户概览里的 32 位十六进制 account id；上传 endpoint 固定由 adapter 生成：`https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`。不要填写 `cfat_` API token、Access Key、bucket 名、公共访问 URL 或自定义域名。
- 不要把 bucket 名拼进 endpoint，不要把 `R2_PUBLIC_BASE_URL` 用作上传 endpoint；`R2_PUBLIC_BASE_URL` 只用于生成公开访问 URL。
- R2 凭据只在服务端 adapter 使用，不输出到日志或前端。
- `CRON_SECRET` 只用于 cron-job.org 调用 `/api/cron/generate-brief`。
- `DASHBOARD_PASSWORD` 和 `AUTH_SECRET` 用于 Dashboard 登录保护。

## Neon Schema

服务端会确保以下表存在：

- `runs`：按 `run_date + run_type` 唯一记录每日任务状态，第一版 `run_type=editorial_brief`。
- `news_items`：保存 20 条候选资讯和原始 JSON。
- `shortlisted_items`：保存 10 条入围资讯、角度、理由、分数和风险提醒。
- `editorial_briefs`：保存 AI 推荐主选题和 R2 报告 key。

## R2 Object

第一版只上传：

```text
reports/{runDate}/editorial-brief.md
```

上传成功后，`editorial_briefs.report_r2_key` 会写入同一个 key。后续封面图、HTML、报告和文章 Markdown 也可以复用该 adapter。

## cron-job.org

配置：

```text
URL:
https://你的域名/api/cron/generate-brief

Method:
POST

Headers:
Authorization: Bearer ${CRON_SECRET}
Content-Type: application/json

Body:
{
  "source": "cron-job.org",
  "task": "daily-editorial-brief"
}
```

行为：

- `Authorization` 不匹配时返回 401。
- 当天已有 `success` 的 `editorial_brief` run 时返回 `already_exists`，不重复生成。
- 失败时 `runs.status=failed`，错误写入 `runs.error`，接口返回 500。

## 安全边界

- cron-job.org 只触发简报生成。
- 不写文章。
- 不生成封面。
- 不写公众号草稿。
- 不调用微信 API。
- 不发布。
- 不群发。
- `/api/cron/generate-brief` 只接受 `CRON_SECRET`。
- `/brief` 和 `/api/brief/today` 需要 Dashboard 登录。

## 验证

部署前本地运行：

```bash
pnpm typecheck
pnpm test
pnpm dashboard:build
```

R2 配置可通过 `GET /api/health/r2` 做最小写入检查；响应只返回脱敏配置，不返回 access key 或 secret。
