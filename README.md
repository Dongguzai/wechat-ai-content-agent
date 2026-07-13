# 公众号 AI 内容生产与草稿发布 Agent

v0.6.0 是一个本地优先、默认 dry-run 的公众号 AI 内容生产流水线。当前默认产品形态是“半自动编辑台模式”：每日先生成编辑简报和主选题推荐，用户确认选题后才继续写文章、审稿、生成封面、排版和草稿 dry-run。

默认运行不会调用真实微信写入接口，不会打开微信公众号后台，不会发布，不会群发。真实创建公众号草稿必须显式打开双开关，并通过官方草稿箱 API 创建草稿，最终发布仍然只能人工完成。

## 能力范围

1. 从 RSS 源采集 AI 资讯，并用 Tavily / Exa global search 线索补充候选。
2. normalize、hard rejection、去重并生成候选池。
3. 进行编辑筛选、选题、事实包构建和安全表达约束。
4. 读取 `config/editorial-style.md`，按账号风格生成文章。
5. 生成 5 个标题候选、评分并选择最终标题，同步到 `article-meta.json` 和 `wechat.html`。
6. 可读取 `feedback/*.json` 的最近人工反馈，作为选题和标题评分参考。
7. 可用 `inputs/manual-topic.md` 或 `--manual-topic` 手动覆盖今日选题，但不能绕过 fact pack 和文章审核。
8. 生成公众号文章、文章审核报告、封面 prompt / mock 封面和封面审核报告。
9. 渲染公众号兼容 HTML；默认不在正文插入封面图。
10. 生成 mock 草稿产物。
11. 生成微信公众号官方 API 草稿箱请求预检和 dry-run 报告。
12. `pnpm dry-run` 或 `pnpm run:daily` 默认生成 `outputs/editorial-brief.md` / `outputs/editorial-brief.json` 并停在人工确认前。
13. 在双开关、凭据、封面素材、最终预检和安全检查全部满足时，允许创建公众号草稿箱草稿。
14. `pnpm run:daily -- --from article` 在读取 `inputs/editorial-approval.json` 且 `approvedByUser=true` 后，继续到 mock 草稿 dry-run，不真实写公众号草稿。
15. `pnpm scheduler:install-brief` / `pnpm scheduler:show` / `pnpm scheduler:uninstall-brief` 管理每天早上 7 点的编辑简报 cron。
16. 保留 `pnpm run:daily:auto` 和 8 点 cron，但默认不建议启用；如果启用全自动草稿链路，必须由用户明确选择并承担真实草稿开关配置。
17. 云端 Phase 1 支持 Vercel Dashboard/API、Neon 结构化数据、Cloudflare R2 简报 Markdown 存档，以及 cron-job.org 每天 7 点触发今日简报生成。
18. 失败通知支持 `console` 与 `webhook`，默认关闭，通知内容会脱敏。

## 当前边界

- 默认不调用真实 MiniMax、Tavily / Exa、APIMart 或微信 API。
- REAL_PRODUCTION_MODE=true 时禁止 mock news、mock search、mock cover 和 fallback mock 进入真实草稿。
- REAL_PRODUCTION_MODE=true 时文章写作、标题生成和文章辅助审核必须使用真实 LLM 产物，不能让 mock LLM 进入草稿。
- 微信真实模式只允许调用官方草稿箱创建接口。
- 不调用发布接口。
- 不调用群发接口。
- 不自动点击“发布”“群发”“确认发送”“立即发送”。
- 不默认操作微信公众号后台页面。
- 不内置常驻定时服务；推荐定时运行只通过系统 cron 调用 `pnpm run:daily -- --until brief`。
- 本地 dry-run 默认不依赖数据库；云端 Dashboard 使用 Neon Postgres 读取今日简报。
- 默认业务产物写入 `outputs/`，成功运行归档写入 `runs/yyyy-mm-dd-HHmmss/`。

## 快速开始

```bash
pnpm install
cp .env.example .env
pnpm env:check
pnpm run:daily
```

常规验收：

```bash
pnpm test
pnpm typecheck
pnpm dashboard:build
```

更多操作步骤见 `docs/runbook.md`，常见问题见 `docs/troubleshooting.md`。

## 云端 Phase 1 架构

云端版第一阶段的职责只到“每日简报”：

- Vercel：Next.js Dashboard / API。
- Neon：存 `runs`、`news_items`、`shortlisted_items`、`editorial_briefs`。
- Cloudflare R2：存 `reports/{runDate}/editorial-brief.md`，后续再存封面图、HTML 和文章归档。
- cron-job.org：每天 7 点调用 Vercel API 生成简报。

调用链路：

```text
cron-job.org
→ POST /api/cron/generate-brief
→ 采集 20 条候选资讯
→ 初筛 10 条入围资讯
→ 推荐今日主选题
→ 写入 Neon
→ 上传 editorial-brief.md 到 R2
→ /brief 从 GET /api/brief/today 读取 Neon
```

需要的云端环境变量：

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
CLOUD_BRIEF_REAL_LOCALIZATION=false
NEWS_LOCALIZER_CONCURRENCY=4
```

`CLOUD_BRIEF_REAL_LOCALIZATION=false` 会让云端 7 点简报使用规则中文化，避免 20 条候选逐条调用 MiniMax 后超过 Vercel Function 300 秒上限。只有确认套餐、时限和调用量足够时，才建议改为 `true`。

cron-job.org 配置：

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

`/api/cron/generate-brief` 只接受 `CRON_SECRET`，不走普通登录。`/brief` 和 `/api/brief/today` 使用 `DASHBOARD_PASSWORD` + HttpOnly cookie 登录保护。cron-job.org 只触发简报生成，不写文章、不生成封面、不写公众号草稿、不发布、不群发。

## Next.js 编辑台

本项目提供 Next.js Dashboard，用于查看每日编辑简报、确认选题、预览文章/封面/公众号 HTML、查看 runs、填写 feedback，并通过后端白名单 action 触发现有安全命令。本地运行时仍可查看本机产物；云端 `/brief` 从 Neon 读取今日 10 条入围资讯，不再读取本地 `outputs/editorial-brief.json`。

启动：

```bash
pnpm dashboard:dev
```

访问：

```text
http://localhost:3000
```

页面包括：

- `/`：今日状态和安全 action 快捷按钮。
- `/brief`：登录后调用 `/api/brief/today`，展示 Neon 中今日 10 条入围资讯和 AI 推荐主选题；今日简报不存在时显示明确等待提示。
- `/approval`：编辑并保存 `inputs/editorial-approval.json`。
- `/article`、`/titles`、`/cover`、`/wechat`：预览文章、标题、封面和公众号 HTML。
- `/runs`：查看历史 `runs/` 归档。
- `/feedback`：创建或编辑 `feedback/*.json`。
- `/settings`：只展示脱敏布尔状态，不显示 `.env` 原文、AppSecret、access token、APIMart key 或 MiniMax key。

Dashboard 的按钮只调用 `/api/action` 中的硬编码白名单：`pnpm run:daily -- --until brief`、`pnpm run:daily -- --from article`、`pnpm wechat:draft:dry-run`、`pnpm preflight:final`、`pnpm wechat:draft:real`、`pnpm feedback:new`。它不接受任意 shell 命令，action 日志写入 `logs/dashboard-actions.log` 并做脱敏。写操作 API 需要登录；`DATABASE_URL`、R2 secret、`CRON_SECRET`、`DASHBOARD_PASSWORD` 和 `AUTH_SECRET` 不会输出到前端。

日常流程：

1. 早上 7 点自动生成 brief，或点击“生成今日编辑简报”。
2. 打开 `/brief` 查看选题。
3. 在 `/approval` 确认选题。
4. 点击“继续写文章”。
5. 查看 `/article`、`/cover`、`/wechat`。
6. 点击“最终 preflight”。
7. 确认双开关和凭据后，才点击“写入公众号草稿箱”。
8. 去公众号后台人工检查并发布。
9. 在 `/feedback` 填写反馈。

系统只创建公众号草稿，不会发布，不会群发，最终发布需人工确认。Dashboard 只用于本地运行，不部署公网。

## 半自动编辑台流程

1. 早上 7 点自动生成编辑简报：

```bash
pnpm run:daily -- --until brief
```

输出：

- `outputs/editorial-brief.md`
- `outputs/editorial-brief.json`
- `outputs/selected-topic.json`

2. 8 点-9 点人工查看简报，确认选题。编辑 `inputs/editorial-approval.json`：

```json
{
  "approvedByUser": true,
  "approvedTopicId": "outputs/editorial-brief.json 中的 topic id",
  "approvedTitle": "可选标题参考",
  "notes": "今天写这个，但角度更偏普通人和创作者影响。"
}
```

没有 `approvedByUser=true` 时，系统不会写文章。

3. 确认后继续生产到草稿 dry-run：

```bash
pnpm run:daily -- --from article
```

该命令会执行 fact pack、article writer、title generator、article review、cover、wechat layout 和 mock draft dry-run，不会真实写入公众号草稿。

4. 检查文章和排版后，手动执行最终预检和真实草稿创建：

```bash
pnpm preflight:final
pnpm wechat:draft:real
```

5. 去公众号后台人工检查草稿并手动发布。系统不会自动发布，也不会自动群发。

兼容命令 `pnpm dry-run` 默认同样停在编辑简报阶段。

如需人工指定今日选题，创建本地文件 `inputs/manual-topic.md`，至少包含标题和来源链接：

```markdown
# Claude Code 和 Goose 的成本冲突，值得重新写一遍

Source URL: https://example.com/source
Source Name: Example
Angle: 从工作流、成本和开源基础设施的角度分析。
Thesis: 编码代理竞争正在从模型能力转向工作流控制权。
```

然后运行：

```bash
pnpm run:daily -- --manual-topic inputs/manual-topic.md
```

如果 `inputs/manual-topic.md` 存在且非空，`pnpm run:daily -- --until brief` 会默认优先使用它。人工选题只覆盖选题入口；确认后仍然必须经过 fact pack、article writer、article reviewer、cover、layout、mock draft 和最终预检。

## 内容质量配置

账号风格放在 `config/editorial-style.md`。当前默认风格是第三视角、旁观者分析、通俗但犀利，不写新闻通稿、不堆英文术语、不写营销号腔；文章结构固定为“冲突切入 → 事实解释 → 行业逻辑 → 影响人群 → 趋势判断”。`topic-editor` 和 `article-writer` 会读取该文件，并在报告里记录是否读取成功。

标题生成会输出：

- `outputs/title-candidates.json`
- `outputs/title-selection-report.md`

每篇文章生成 5 个标题：判断型、反差型、趋势型、普通人影响型、技术圈讨论型。每个标题都有 `spreadScore`、`accuracyScore`、`nonClickbaitScore`、`wechatFitScore`、`thesisMatchScore`、`finalScore`。`outputs/title-candidates.json` 同时记录本次标题生成的 `llm` 元信息。最终标题会写入 `outputs/article-meta.json`，并由 `outputs/wechat.html` 使用。

## MiniMax Token Plan / MiniMax LLM 配置

文章正文、标题生成和文章审核辅助可以使用 MiniMax OpenAI-compatible chat completions。默认仍是 mock/deterministic 模式，不调用外部 LLM：

```env
LLM_PROVIDER=minimax
MINIMAX_BASE_URL=https://api.minimaxi.com/v1
# 按量计费 API Key 请填写 MiniMax 控制台或 /v1/models 返回的真实模型 id。
# 例如使用 M3 时，填控制台中 M3 对应的 model id。
MINIMAX_MODEL=
MINIMAX_MAX_COMPLETION_TOKENS=2048
MINIMAX_TEMPERATURE=0.75
ARTICLE_WRITER_PROVIDER=minimax
ARTICLE_WRITER_MODEL=
ARTICLE_WRITER_MAX_COMPLETION_TOKENS=4096
TITLE_GENERATOR_PROVIDER=minimax
TITLE_GENERATOR_MODEL=
TITLE_GENERATOR_MAX_COMPLETION_TOKENS=
ARTICLE_REVIEWER_PROVIDER=minimax
ARTICLE_REVIEWER_MODEL=
ARTICLE_REVIEWER_MAX_COMPLETION_TOKENS=
LLM_ENABLE_REAL_API=false
LLM_DRY_RUN=true
```

开启真实写作、标题和辅助审稿时，必须在本地 `.env` 或 shell 中提供：

```env
MINIMAX_API_KEY=你的MiniMaxKey
LLM_ENABLE_REAL_API=true
LLM_DRY_RUN=false
LLM_PROVIDER=minimax
MINIMAX_MODEL=MiniMax控制台返回的M3模型id
```

模型优先级为：`ARTICLE_WRITER_MODEL` / `TITLE_GENERATOR_MODEL` / `ARTICLE_REVIEWER_MODEL` 优先；未设置时回退到 `MINIMAX_MODEL`。正文写作会自动使用不低于 `4096` 的 completion token 预算，避免长 JSON 被截断；如文章仍被截断，可把 `ARTICLE_WRITER_MAX_COMPLETION_TOKENS` 提到 `8192`。如果要确认按量计费 key 可用、以及 M3 的真实 model id，先运行：

```bash
pnpm llm:minimax:models
```

该命令只调用 `GET {MINIMAX_BASE_URL}/models`，使用 `Authorization: Bearer ${MINIMAX_API_KEY}`，只输出模型 id 列表，不会输出完整 API Key，不会调用 chat completions、APIMart 或微信 API。若返回 401，请检查按量计费 API Key 是否有效，以及国内站 key 是否使用 `https://api.minimaxi.com/v1`、国际站 key 是否使用 `https://api.minimax.io/v1`。

查看本次使用的模型和 token usage：

- `outputs/article-meta.json` 的 `llm`
- `outputs/title-candidates.json` 的 `llm`
- `outputs/article-review.json` 的 `llm`
- `outputs/daily-auto-report.md` 的 `writerModel` / `titleModel` / `reviewerModel`

正式生产模式下，`preflight:final` 会阻断 mock LLM 产物进入公众号草稿。不要把 `.env`、`MINIMAX_API_KEY`、真实凭据或 token 提交到 git。

人工反馈模板可用命令生成：

```bash
pnpm feedback:new
```

该命令只读本地 `outputs/article-meta.json` 或最新 `runs/*` 产物，生成 `feedback/yyyy-mm-dd-title-slug.json`，不会调用外部 API，也不会覆盖已有文件。也可以参考 `feedback/template.json` 手工填写：

```json
{
  "date": "2026-05-30",
  "title": "文章标题",
  "topic": "主选题",
  "draftMediaId": "",
  "published": true,
  "views": 1200,
  "likes": 18,
  "shares": 6,
  "myRating": 4,
  "topicQuality": 4,
  "titleQuality": 3,
  "coverQuality": 3,
  "articleProblems": ["标题可以更准确"],
  "notes": "技术圈讨论不错，但普通人影响可以更早出现。"
}
```

没有 feedback 文件时流程不会失败；存在多个 feedback JSON 时会读取日期最近的一份。

2. 如需单独重跑官方 API 草稿 dry-run：

```bash
pnpm wechat:draft:dry-run
```

3. 准备真实 JPG/PNG/JPEG 封面并上传为公众号封面素材：

```bash
WECHAT_APP_ID=你的AppID \
WECHAT_APP_SECRET=你的AppSecret \
WECHAT_COVER_IMAGE_PATH=/absolute/path/to/cover.png \
pnpm wechat:upload-cover
```

成功后保存命令输出的 `WECHAT_COVER_MEDIA_ID=...`。

4. 执行真实草稿写入前最终预检：

```bash
pnpm preflight:final
```

5. 创建公众号草稿箱草稿：

```bash
WECHAT_API_ENABLE_REAL_DRAFT=true \
WECHAT_DRAFT_ALLOW_REAL_API=true \
WECHAT_DRAFT_DRY_RUN=false \
WECHAT_APP_ID=你的AppID \
WECHAT_APP_SECRET=你的AppSecret \
WECHAT_COVER_MEDIA_ID=已上传的thumb_media_id \
pnpm wechat:draft:real
```

如果同一天已经成功创建过真实草稿，`pnpm wechat:draft:real` 会默认阻止重复写入。也就是说，同一天重复创建真实草稿需要显式追加 `--force`：

```bash
pnpm wechat:draft:real -- --force
```

公众号封面只通过草稿请求里的 `thumb_media_id` 设置，也就是上一步保存的 `WECHAT_COVER_MEDIA_ID`。它不会再被重复插入正文 HTML。

6. 人工登录公众号后台检查草稿，再由人工决定是否发布。

## 每日定时运行

推荐安装每天早上 7 点的编辑简报任务：

```bash
pnpm scheduler:install-brief
```

安装的 cron 只执行：

```cron
0 7 * * * cd /Users/Shared/AgentWork/公众号AI内容生产与草稿发布Agent/wechat-ai-content-agent && pnpm run:daily -- --until brief >> logs/editorial-brief.log 2>&1
```

该任务不写文章、不生成封面、不写入公众号草稿、不调用微信真实 API、不发布、不群发。

保留旧的 `pnpm run:daily:auto`，但默认不建议启用。它会按顺序执行：

1. `pnpm run:daily`
2. `real-data-audit`
3. `pnpm wechat:draft:dry-run`
4. `pnpm preflight:final`
5. `pnpm wechat:draft:real`

脚本会自动加载 `.env`，运行前要求：

- `REAL_PRODUCTION_MODE=true`
- `LLM_ENABLE_REAL_API=true`
- `LLM_DRY_RUN=false`
- `LLM_PROVIDER=minimax`
- `MINIMAX_API_KEY` 存在
- `RSS_ENABLE_REAL_FETCH=true`
- `SEARCH_ENABLE_REAL_API=true`
- `COVER_ENABLE_REAL_API=true`
- `WECHAT_API_ENABLE_REAL_DRAFT=true`
- `WECHAT_DRAFT_ALLOW_REAL_API=true`
- `APIMART_API_KEY` 存在
- `APIMART_IMAGE_API_URL` 存在
- `WECHAT_APP_ID` 存在
- `WECHAT_APP_SECRET` 存在

真实草稿阶段会确保 `WECHAT_DRAFT_DRY_RUN=false`。任意一步失败都会立即停止，后续步骤标记为 skipped，不会自动追加 `--force`。

手动运行：

```bash
pnpm run:daily:auto
```

如果同一天已经创建过真实草稿，任务会被 same-day lock 阻止。只有手动重复测试且明确接受重复草稿时，才使用：

```bash
pnpm run:daily:auto -- --force
```

安装每天早上 8 点的系统 cron：

```bash
pnpm scheduler:install
```

查看项目相关 cron：

```bash
pnpm scheduler:show
```

取消项目 cron：

```bash
pnpm scheduler:uninstall
```

安装后的 cron 块为：

```cron
# wechat-ai-content-agent daily auto start
0 8 * * * cd /Users/Shared/AgentWork/公众号AI内容生产与草稿发布Agent/wechat-ai-content-agent && pnpm run:daily:auto >> logs/daily-auto.log 2>&1
# wechat-ai-content-agent daily auto end
```

查看日志：

```bash
tail -f logs/daily-auto.log
```

每日自动运行会生成：

- `outputs/daily-auto-result.json`
- `outputs/daily-auto-report.md`
- `logs/daily-auto.log`
- `runs/yyyy-mm-dd-HHmmss/run-report.md`

cron 不会发布文章，也不会群发文章；它只会在全部审核和最终预检通过后创建公众号草稿箱草稿。最终发布仍需要人工进入公众号后台确认。如果同一天已经创建草稿，任务会被 same-day lock 阻止。不要把 `.env`、真实凭据、token、`outputs/` 业务产物或 `logs/daily-auto.log` 提交到 git。更多说明见 `docs/scheduler.md`。

## 常用脚本

| command | purpose |
| --- | --- |
| `pnpm dev` | 运行入口文件 |
| `pnpm env:check` | 检查 `.env` 格式、变量漂移、当前草稿模式和真实模式必填项 |
| `pnpm dry-run` | 默认执行到编辑简报并停在人工确认前 |
| `pnpm run:daily -- --until brief` | 生成候选、入围、主选题和编辑简报 |
| `pnpm run:daily -- --from article` | 读取人工确认后继续到 mock 草稿 dry-run |
| `pnpm run:daily -- --from layout` | 从已有文章、meta 和封面继续审核、排版和 mock 草稿 dry-run |
| `pnpm run:daily:auto` | 保留的旧自动草稿链路，默认不建议启用 |
| `pnpm scheduler:install-brief` | 安装项目专属 7 点编辑简报 cron |
| `pnpm scheduler:uninstall-brief` | 只移除 7 点编辑简报 cron |
| `pnpm scheduler:install` | 安装保留的 8 点 daily:auto cron |
| `pnpm scheduler:show` | 查看当前项目相关 cron |
| `pnpm scheduler:uninstall` | 只移除当前项目 cron 块，不影响其他 cron |
| `pnpm feedback:new` | 从最新本地产物生成反馈模板，不调用外部 API |
| `pnpm preflight:final` | 检查真实草稿写入前的最终条件，不调用真实微信 API |
| `pnpm wechat:upload-cover -- --dry-run` | 演练封面素材上传脚本，不调用真实微信接口 |
| `pnpm wechat:upload-cover` | 上传真实 JPG/PNG 封面素材并输出 `WECHAT_COVER_MEDIA_ID` |
| `pnpm wechat:draft:dry-run` | 生成官方 API 草稿请求预检，不调用真实微信接口 |
| `pnpm wechat:draft:real` | 在双开关和凭据齐备时创建真实公众号草稿 |
| `pnpm test` | 运行 Node test 套件 |
| `pnpm typecheck` | 运行 TypeScript 类型检查 |

## dry-run 产物

`pnpm dry-run` / `pnpm run:daily -- --until brief` 会生成或更新以下业务产物：

- `outputs/raw-news.json`
- `outputs/normalized-news.json`
- `outputs/rejected-news.json`
- `outputs/candidate-news.json`
- `outputs/collection-report.md`
- `outputs/shortlisted-news.json`
- `outputs/shortlist-report.md`
- `outputs/selected-topic.json`
- `outputs/topic-selection-report.md`
- `outputs/editorial-brief.md`
- `outputs/editorial-brief.json`
- `outputs/daily-report.md`

确认选题并运行 `pnpm run:daily -- --from article` 后，才会继续生成：

- `outputs/topic-fact-pack.json`
- `outputs/topic-fact-pack.md`
- `outputs/article.md`
- `outputs/article-meta.json`
- `outputs/article-writing-report.md`
- `outputs/title-candidates.json`
- `outputs/title-selection-report.md`
- `outputs/article-review.json`
- `outputs/article-review-report.md`
- `outputs/cover.json`
- `outputs/cover-prompt.md`
- `outputs/cover-review.json`
- `outputs/covers/`
- `outputs/wechat.html`
- `outputs/wechat-layout.json`
- `outputs/wechat-layout-report.md`
- `outputs/wechat-draft-result.json`
- `outputs/wechat-draft-report.md`

官方 API 草稿请求预检由 `pnpm wechat:draft:dry-run` 生成：

- `outputs/wechat-api-preflight.json`
- `outputs/wechat-api-draft-result.json`
- `outputs/wechat-api-draft-report.md`

`pnpm dry-run` 和 `pnpm run:daily` 成功后，还会把核心产物复制到 `runs/yyyy-mm-dd-HHmmss/`，并写入 `run-manifest.json` 和 `run-report.md`。`runs/` 业务归档默认被 `.gitignore` 忽略，只保留 `runs/.gitkeep`。

`outputs/.gitkeep` 只是目录占位文件，不是业务产物。

## 公众号图片策略

- 公众号封面通过官方草稿接口的 `thumb_media_id` 设置，对应本项目中的 `WECHAT_COVER_MEDIA_ID`。
- 当前 v0.3.1 默认 `renderWechatHtml.ts` 中 `INSERT_COVER_IN_CONTENT=false`，因此 `outputs/wechat.html` 顶部不会自动插入 `cover.json` 的 `imagePath`。
- 正文内图片不能使用本地路径、`outputs/covers` 路径或 `/Users/` 这类机器路径。需要先通过微信 `uploadimg` 接口上传，再把正文 HTML 中的图片地址替换为微信返回的 URL。

## 真实草稿写入

真实创建公众号草稿前需要：

- 公众号 `AppID` / `AppSecret`
- 当前机器或服务器 IP 已加入公众号后台 IP 白名单
- 已上传的 `WECHAT_COVER_MEDIA_ID`，或本地真实 JPG/PNG 封面图片路径；最终草稿封面通过 `thumb_media_id` 设置
- `outputs/article-review.json` 通过
- `outputs/cover-review.json` 通过
- `outputs/wechat-layout.json` 显示兼容公众号 HTML
- `pnpm preflight:final` 通过
- 人工确认最终发布只在公众号后台手动完成

真实写入必须显式打开两个开关，并关闭 dry-run：

```bash
WECHAT_API_ENABLE_REAL_DRAFT=true \
WECHAT_DRAFT_ALLOW_REAL_API=true \
WECHAT_DRAFT_DRY_RUN=false \
WECHAT_APP_ID=你的AppID \
WECHAT_APP_SECRET=你的AppSecret \
WECHAT_COVER_MEDIA_ID=已上传的thumb_media_id \
pnpm wechat:draft:real
```

同一天重复创建真实草稿会被 `.local/wechat-draft-locks/yyyy-mm-dd.json` 阻止；确认需要覆盖时必须使用 `pnpm wechat:draft:real -- --force`，否则不会发起第二次草稿创建请求。

如果没有 `WECHAT_COVER_MEDIA_ID`，可以先用真实 JPG/PNG 封面上传素材：

```bash
WECHAT_APP_ID=你的AppID \
WECHAT_APP_SECRET=你的AppSecret \
WECHAT_COVER_IMAGE_PATH=/absolute/path/to/cover.png \
pnpm wechat:upload-cover
```

mock SVG 封面不会进入真实草稿箱写入。

## 环境变量

CLI 入口会自动加载项目根目录的 `.env`。命令行或 shell 已经设置的同名变量优先级更高，`.env` 不会覆盖它们。可以随时执行：

```bash
pnpm env:check
```

检查项包括 `.env` 语法、`.env.example` 是否覆盖当前代码读取点、`.env` 是否有未声明变量、布尔/数字/枚举值是否合法，以及真实搜索、真实封面和真实公众号草稿模式的必填项是否齐备。

`pnpm env:check` 会明确提示当前微信草稿模式：

- dry-run/preflight 模式：只生成请求预览和预检产物，不获取 `access_token`，不创建真实公众号草稿。
- real 模式：需要 `WECHAT_API_ENABLE_REAL_DRAFT=true`、`WECHAT_DRAFT_ALLOW_REAL_API=true`、`WECHAT_DRAFT_DRY_RUN=false`、AppID/AppSecret，以及 `WECHAT_COVER_MEDIA_ID` 或真实 JPG/PNG 封面路径。该模式也只允许创建草稿，不允许发布或群发。

`env:check` 本身只做本地配置检查，不调用微信 API。

`.env.example` 按当前代码读取点分组维护。默认值用于安全 dry-run：

- `SEARCH_ENABLE_REAL_API=false`：搜索补充走 mock adapter。
- `NEWS_LOOKBACK_HOURS=72`：每日简报候选必须能验证为最近 72 小时内发布，超窗或缺少发布时间会进入 `rejected-news.json`。
- `COVER_ENABLE_REAL_API=false`：封面走本地 mock SVG；开启真实 APIMart 生图时还需要 `APIMART_API_KEY` 与 `APIMART_IMAGE_API_URL`，`APIMART_COVER_STYLE` 会先做具体工作室名称安全替换再进入 prompt。
- `WECHAT_API_ENABLE_REAL_DRAFT=false`、`WECHAT_DRAFT_ALLOW_REAL_API=false`、`WECHAT_DRAFT_DRY_RUN=true`：官方 API 草稿写入只做预检。
- `WECHAT_FORBID_PUBLISH=true`、`WECHAT_FORBID_MASS_SEND=true`：发布和群发防线保持开启。
- `NOTIFY_ENABLE=false`：每日自动运行通知默认关闭。
- `NOTIFY_METHOD=console`：通知方式可选 `console` 或 `webhook`。
- `NOTIFY_ON_FAILURE=true`、`NOTIFY_ON_SUCCESS=false`：开启通知后默认只发失败通知；成功通知需显式打开。

不要把 `.env`、公众号凭据、素材 media id、access token、cookie 或登录态文件提交到 git。也不要把 `WECHAT_APP_ID`、`WECHAT_APP_SECRET`、`WECHAT_COVER_MEDIA_ID`、`WECHAT_COVER_IMAGE_PATH` 写进前端可见变量、HTML、客户端 bundle 或 `NEXT_PUBLIC_` / `VITE_` / `PUBLIC_` 前缀变量。

## 项目结构

- `src/pipeline/`：流水线步骤模块。
- `src/adapters/`：外部服务 adapter。
- `src/hooks/`：安全约束。
- `src/types/`：核心类型定义。
- `src/config/`：采集和评分配置。
- `src/skills/`：各子任务技能说明。
- `config/editorial-style.md`：账号写作风格配置。
- `feedback/template.json`：人工反馈模板；真实反馈 JSON 默认本地忽略。
- `inputs/manual-topic.md`：可选人工选题文件，默认本地忽略。
- `scripts/`：命令行运行脚本。
- `tests/`：Node test 测试。
- `docs/`：运行、排障和微信草稿风控文档。
- `outputs/`：dry-run 产物目录。
- `runs/`：成功运行的核心产物归档目录。
- `logs/`：每日自动运行日志目录。

## 安全约束

- `requireSourceUrl`：资讯缺少 `url` 时立即报错。
- `requireChineseNewsLanguage`：采集后的资讯标题、搜索 query、摘要和正文片段必须中文化；固定专名和常见缩写允许保留英文，普通说明词未中文化时立即报错或 hard rejection。
- `forbidAutoPublish`：检测到高风险发送词时立即报错。
- `forbidWechatPublishApi`：检测到发布、群发、freepublish、mass、sendall 等 API URL 或 actionName 时立即报错。
- `forceApimartImage`：封面 provider 只能是 APIMart。
- `saveWechatDraft`：只返回 mock 草稿记录，不触发真实后台或浏览器操作。
- `saveWechatDraftApi`：默认只生成官方 API 草稿请求预览；真实模式也只允许创建草稿箱草稿。
- `.gitignore`：忽略 `.env`、`.env.*`、`.local/` 和 `outputs/` 业务产物，只允许提交 `.env.example` 与 `outputs/.gitkeep`。

封板验收以 `pnpm test` 和 `pnpm typecheck` 通过为准。
