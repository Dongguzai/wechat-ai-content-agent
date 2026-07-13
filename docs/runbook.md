# v0.6.0 Runbook

本文档用于 v0.6.0 半自动编辑台模式的每日运行、人工确认、真实草稿写入、7 点简报定时任务、失败通知和异常处理。除非明确进入真实草稿模式，所有命令都保持 dry-run；系统不发布、不群发、不打开微信公众号后台。

## 1. 环境准备

要求：

- Node.js >= 20
- pnpm >= 9
- 不提交 `.env`
- 不提交 `outputs/`、`runs/` 或 `logs/` 业务产物

首次准备：

```bash
pnpm install
cp .env.example .env
pnpm env:check
```

CLI 入口会自动加载项目根目录的 `.env`，但不会覆盖当前 shell 已设置的同名变量。真实 API key、公众号凭据和 `WECHAT_COVER_MEDIA_ID` 只写入本地 `.env` 或命令行环境变量。

## 2. 半自动编辑台流程

每日早上 7 点或手动执行：

```bash
pnpm run:daily -- --until brief
```

该命令只执行资讯采集、候选筛选、入围筛选、主选题推荐和编辑简报生成，并强制保持：

- `WECHAT_DRAFT_DRY_RUN=true`
- `WECHAT_API_ENABLE_REAL_DRAFT=false`
- `WECHAT_DRAFT_ALLOW_REAL_API=false`

预期结果：

- 命令退出码为 0。
- `outputs/daily-report.md` 生成。
- `outputs/editorial-brief.md` 生成。
- `outputs/editorial-brief.json` 中包含 20 条候选、10 条入围、推荐主选题、2 条备选、风险提醒和 `approvalRequired=true`。
- `outputs/selected-topic.json` 生成。
- 不生成 `outputs/article.md`。
- 不生成 `outputs/cover.json`。
- 不生成 `outputs/wechat-draft-result.json`。
- 不生成 `outputs/wechat-api-preflight.json`。
- 核心产物复制到 `runs/yyyy-mm-dd-HHmmss/`，并生成 `run-manifest.json` 和 `run-report.md`。

兼容命令：

```bash
pnpm dry-run
```

`pnpm dry-run` 与 `pnpm run:daily -- --until brief` 一样默认停在编辑简报阶段。

人工确认选题：

```json
{
  "approvedByUser": true,
  "approvedTopicId": "editorial-brief.json 中的 topic id",
  "approvedTitle": "可选标题参考",
  "notes": "今天写这个，但角度更偏普通人和创作者影响。"
}
```

继续生产到 mock 草稿 dry-run：

```bash
pnpm run:daily -- --from article
```

要求：

- `inputs/editorial-approval.json` 存在。
- `approvedByUser=true`。
- `approvedTopicId` 能匹配 `selected-topic.json` 或 `shortlisted-news.json`。
- `notes` 会传入 article writer。
- `approvedTitle` 会作为标题参考传入 title generator，但仍会经过 forbidden terms 检查。

预期结果：

- `outputs/topic-fact-pack.json` 生成。
- `outputs/article.md` 和 `outputs/article-meta.json` 生成。
- `outputs/title-candidates.json` 生成 5 个标题候选。
- `outputs/article-review.json` 中 `passed=true`。
- `outputs/cover-review.json` 中 `passed=true`。
- `outputs/wechat-layout.json` 中 `compatibleWithWechat=true` 且 `allowedNextStage=true`。
- `outputs/wechat-draft-result.json` 为 mock 草稿结果。
- 不直接真实写入公众号草稿。
- 官方 API preflight 仍通过后续 `pnpm wechat:draft:dry-run` 或 `pnpm preflight:final` 串联检查。

如只需从已有文章和封面继续：

```bash
pnpm run:daily -- --from layout
```

该命令从已有 `article.md` / `article-meta.json` / `cover.json` 继续执行 article review、cover review、layout 和 mock draft dry-run，不发布、不群发。

## 2.1 本地 Next.js 编辑台

编辑台位于 `apps/dashboard/`，使用 Next.js、TypeScript、Tailwind CSS、App Router 和 Node.js runtime API routes。本地页面仍可查看本机白名单目录中的产物；云端 Phase 1 的 `/brief` 改为通过 `/api/brief/today` 从 Neon 读取今日简报。

启动：

```bash
pnpm dashboard:dev
```

访问：

```text
http://localhost:3000
```

日常流程：

1. 早上 7 点自动生成 brief，或点击“生成今日编辑简报”。
2. 打开 `/brief` 查看选题。
3. 在 `/approval` 确认选题并保存 `inputs/editorial-approval.json`。
4. 点击“继续写文章”。
5. 查看 `/article`、`/cover`、`/wechat`。
6. 点击“最终 preflight”。
7. 双开关、凭据、封面素材和预检都满足后，才点击“写入公众号草稿箱”。
8. 去公众号后台人工检查并发布。
9. 在 `/feedback` 填写反馈。

安全边界：

- `/brief` 页面需要 `DASHBOARD_PASSWORD` 登录。
- `/api/brief/today` 需要登录。
- `/api/cron/generate-brief` 只接受 `Authorization: Bearer ${CRON_SECRET}`，不走普通登录。
- Dashboard 写操作 API 需要登录。
- 文件读取 API 只允许 `outputs/`、`runs/`、`feedback/`、`inputs/`、`docs/`。
- 文件读取 API 禁止 `.env`、`node_modules/`、`.git/`、绝对路径、路径穿越和 secret/token 文件。
- `/settings` 只展示脱敏布尔状态，不显示 `.env` 内容、AppSecret、access token、APIMart key 或 MiniMax key。
- `/api/action` 只允许执行白名单 action，不允许输入任意 shell command。
- 禁止 action 包含 `publish`、`freepublish`、`mass`、`sendall`、`群发`、`发布`、`确认发送`、`立即发送`。
- action 日志写入 `logs/dashboard-actions.log`，stdout/stderr 摘要会脱敏。
- 系统只创建公众号草稿，不会发布，不会群发，最终发布需人工确认。
- `DATABASE_URL`、R2 secret、`CRON_SECRET`、`DASHBOARD_PASSWORD` 和 `AUTH_SECRET` 不输出到前端或日志。

## 2.2 云端 Phase 1：Neon / R2 / cron-job.org

云端版架构：

- Vercel：Next.js Dashboard / API。
- Neon：结构化数据。
- Cloudflare R2：文件对象。
- cron-job.org：每天 7 点触发生成简报。

环境变量：

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

R2 上传 endpoint 只由 `R2_ACCOUNT_ID` 生成，格式固定为
`https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`。`R2_ACCOUNT_ID` 只能填写纯
account id，也就是 Cloudflare 账户概览里的 32 位十六进制值；不要填写 `cfat_`
API token、Access Key、bucket 名、`https://`、公共访问域名或
`.r2.cloudflarestorage.com`。
`R2_PUBLIC_BASE_URL` 只用于生成公开访问 URL，不能用于上传。
`R2_BUCKET` 只能填写 bucket 名，例如 `briefs`；不要粘贴 `R2_ENDPOINT=https://...`
整行，也不要填写 endpoint URL。

云端 7 点简报建议保持 `CLOUD_BRIEF_REAL_LOCALIZATION=false`，用规则中文化候选资讯，减少逐条 MiniMax 调用，避免 Vercel Function 触发 300 秒超时。只有确认需要真实逐条中文化并且时限足够时，再改成 `true`。

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

`/api/cron/generate-brief` 行为：

- 验证 `CRON_SECRET`。
- 检查今天是否已有 `success` 的 `editorial_brief` run。
- 已存在时返回 `already_exists`，不重复生成。
- 未存在时创建或重置当天 run 为 `running`。
- 运行现有采集、初筛、选题、简报生成逻辑。
- 保存 20 条候选到 `news_items`。
- 保存 10 条入围到 `shortlisted_items`。
- 保存主选题推荐到 `editorial_briefs`。
- 上传 `reports/{runDate}/editorial-brief.md` 到 R2。
- 成功后 `runs.status=success`。
- 失败后 `runs.status=failed`，错误写入 `runs.error`，接口返回 500。

边界：

- cron-job.org 只触发简报生成。
- 不写文章。
- 不生成封面。
- 不写公众号草稿。
- 不调用微信 API。
- 不发布。
- 不群发。

Dashboard 验证：

```bash
pnpm typecheck
pnpm test
pnpm dashboard:build
```

## 3. 内容质量配置

账号写作风格配置在 `config/editorial-style.md`。默认要求：

- 第三视角。
- 旁观者分析。
- 通俗但犀利。
- 不写新闻通稿。
- 不堆英文术语。
- 不写营销号腔。
- 结构为：冲突切入 → 事实解释 → 行业逻辑 → 影响人群 → 趋势判断。

`topic-editor` 和 `article-writer` 会读取该文件；是否读取成功会写入 `outputs/topic-selection-report.md`、`outputs/article-writing-report.md`、`outputs/daily-report.md` 和归档目录里的 `run-report.md`。

标题生成阶段会输出：

- `outputs/title-candidates.json`
- `outputs/title-selection-report.md`

查看最终标题选择理由：

```bash
cat outputs/title-selection-report.md
```

最终标题会同步到 `outputs/article-meta.json`，并在 `outputs/wechat.html` 中使用。标题生成只做内容质量优化，不调用微信 API，不发布，不群发。

## 3.1 MiniMax Token Plan / MiniMax LLM 配置

MiniMax 只接入文字模型能力，用于文章正文、标题生成和文章辅助审核。封面仍走 APIMart，公众号草稿仍走微信公众号官方 API。

默认配置保持 dry-run，不调用 MiniMax：

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

开启真实 MiniMax 调用：

```env
MINIMAX_API_KEY=你的MiniMaxKey
LLM_ENABLE_REAL_API=true
LLM_DRY_RUN=false
LLM_PROVIDER=minimax
MINIMAX_MODEL=MiniMax控制台返回的M3模型id
```

模型优先级：

- `ARTICLE_WRITER_MODEL` 优先于 `MINIMAX_MODEL`。
- `TITLE_GENERATOR_MODEL` 优先于 `MINIMAX_MODEL`。
- `ARTICLE_REVIEWER_MODEL` 优先于 `MINIMAX_MODEL`。
- 子模块模型为空时，统一回退到 `MINIMAX_MODEL`。
- 正文写作会自动使用不低于 `4096` 的 completion token 预算；如果真实模型仍返回截断 JSON，可把 `ARTICLE_WRITER_MAX_COMPLETION_TOKENS` 调到 `8192`。

按量计费 key 和 M3 模型检查：

```bash
pnpm llm:minimax:models
```

该命令只请求 `GET {MINIMAX_BASE_URL}/models`，不会调用 chat completions、APIMart 或微信 API，也不会输出完整 `MINIMAX_API_KEY`。如果返回 401，优先检查按量计费 API Key 是否有效；国内站 key 使用 `https://api.minimaxi.com/v1`，国际站 key 使用 `https://api.minimax.io/v1`，并确认 key 处于 active 状态。

查看本次模型和 token usage：

- `outputs/article-meta.json` 的 `llm`
- `outputs/title-candidates.json` 的 `llm`
- `outputs/article-review.json` 的 `llm`
- `outputs/daily-report.md`
- `outputs/daily-auto-report.md`

注意：

- `MINIMAX_API_KEY` 只能从环境变量读取，不能写死到代码、outputs、logs 或报告。
- MiniMax 原始响应不得完整落盘，只保留必要字段和 usage。
- `LLM_ENABLE_REAL_API=false` 时，测试和 dry-run 不依赖外部 API。
- `REAL_PRODUCTION_MODE=true` 时，`preflight:final` 会阻断 mock LLM 产物进入公众号草稿。

## 4. 手动选题

手动选题文件为 `inputs/manual-topic.md`。如果该文件存在且非空，`pnpm run:daily` 会优先使用它。也可以显式指定路径：

```bash
pnpm run:daily -- --manual-topic inputs/manual-topic.md
```

推荐格式：

```markdown
# 今日选题标题

Source URL: https://example.com/source
Source Name: Example
Angle: 从冲突、事实边界和行业逻辑分析。
Thesis: 这条资讯说明某类 AI 工作流正在发生变化。
```

注意：

- `Source URL` 必填，否则 fact pack 无法运行。
- 手动选题只覆盖选题入口。
- 手动选题仍必须经过 fact pack、article writer、article reviewer、cover、layout、mock draft 和官方 API dry-run 预检。
- 不要把未经核验的判断写成事实；manual-topic 里的内容仍会被 fact pack 和 reviewer 约束。

## 5. 人工反馈

人工反馈模板可自动生成：

```bash
pnpm feedback:new
```

该命令根据最新 `outputs/article-meta.json` 或 `runs/*` 生成 `feedback/yyyy-mm-dd-title-slug.json`，不覆盖已有文件，不调用任何外部 API。

也可以复制 `feedback/template.json` 为日期文件，例如：

```bash
cp feedback/template.json feedback/2026-05-30.json
```

填写字段：

- `date`
- `title`
- `topic`
- `draftMediaId`
- `published`
- `views`
- `likes`
- `shares`
- `myRating`
- `topicQuality`
- `titleQuality`
- `coverQuality`
- `articleProblems`
- `notes`

流程会读取日期最近的一份 feedback JSON，用于后续选题报告和标题评分参考。没有 feedback 文件时流程不会失败。真实 feedback JSON 默认被 `.gitignore` 忽略，只提交 `feedback/template.json`。

## 6. 真实草稿写入流程

真实写入前，先确认已经完成半自动流程和草稿 dry-run：

```bash
pnpm run:daily -- --from article
pnpm wechat:draft:dry-run
```

准备封面素材。真实草稿需要 `WECHAT_COVER_MEDIA_ID`，或可上传的真实 JPG/PNG/JPEG 封面图片路径：

```bash
WECHAT_APP_ID=你的AppID \
WECHAT_APP_SECRET=你的AppSecret \
WECHAT_COVER_IMAGE_PATH=/absolute/path/to/cover.png \
pnpm wechat:upload-cover
```

成功后把命令输出的 `WECHAT_COVER_MEDIA_ID=...` 写入本地 `.env` 或当前 shell。

执行最终预检：

```bash
pnpm preflight:final
```

最终预检会检查：

- 文章审核通过。
- 封面审核通过。
- 公众号 HTML 排版允许进入下一阶段。
- 官方 API 草稿 dry-run 通过。
- 正文、标题和文章辅助审核 LLM 产物满足正式生产模式要求。
- `WECHAT_COVER_MEDIA_ID` 存在，或存在可上传的真实 JPG/PNG/JPEG 封面图片。
- HTML 不包含本地图片路径。
- HTML 不包含发布或群发风险词。
- 只存在草稿箱创建接口，不存在 publish、freepublish、mass、sendall 等接口路径。
- `outputs/` 中没有写入 AppSecret 或 token 字段。
- 同一天没有成功创建过真实草稿。

全部通过后，才能创建真实公众号草稿箱草稿：

```bash
WECHAT_API_ENABLE_REAL_DRAFT=true \
WECHAT_DRAFT_ALLOW_REAL_API=true \
WECHAT_DRAFT_DRY_RUN=false \
WECHAT_APP_ID=你的AppID \
WECHAT_APP_SECRET=你的AppSecret \
WECHAT_COVER_MEDIA_ID=已上传的thumb_media_id \
pnpm wechat:draft:real
```

成功创建真实草稿后，系统会写入 `.local/wechat-draft-locks/yyyy-mm-dd.json`。同一天再次执行真实草稿写入会被阻止。确认需要覆盖时，必须显式使用：

```bash
pnpm preflight:final -- --force
pnpm wechat:draft:real -- --force
```

最终发布仍必须由人工登录微信公众号后台完成。

没有人工确认选题时，不会写文章；系统不会自动发布，也不会自动群发。

## 7. 每日定时运行

推荐每日自动任务只生成 7 点编辑简报：

```bash
pnpm scheduler:install-brief
```

安装后的 cron 块：

```cron
# wechat-ai-content-agent editorial brief start
0 7 * * * cd /Users/Shared/AgentWork/公众号AI内容生产与草稿发布Agent/wechat-ai-content-agent && pnpm run:daily -- --until brief >> logs/editorial-brief.log 2>&1
# wechat-ai-content-agent editorial brief end
```

该任务只生成编辑简报，不写文章、不生成封面、不写入公众号草稿、不调用微信真实 API、不发布、不群发。

保留的每日自动草稿任务使用：

```bash
pnpm run:daily:auto
```

它按固定顺序执行：

1. `pnpm run:daily -- --from article`
2. `real-data-audit`
3. `pnpm wechat:draft:dry-run`
4. `pnpm preflight:final`
5. `pnpm wechat:draft:real`

要求 `.env` 或当前 shell 中已经配置：

- `REAL_PRODUCTION_MODE=true`
- `LLM_ENABLE_REAL_API=true`
- `LLM_DRY_RUN=false`
- `LLM_PROVIDER=minimax`
- `MINIMAX_API_KEY`
- `RSS_ENABLE_REAL_FETCH=true`
- `SEARCH_ENABLE_REAL_API=true`
- `COVER_ENABLE_REAL_API=true`
- `APIMART_API_KEY`
- `APIMART_IMAGE_API_URL`
- `WECHAT_APP_ID`
- `WECHAT_APP_SECRET`
- `WECHAT_API_ENABLE_REAL_DRAFT=true`
- `WECHAT_DRAFT_ALLOW_REAL_API=true`

脚本会自动加载 `.env`，真实草稿阶段会确保 `WECHAT_DRAFT_DRY_RUN=false`。任意一步失败都会停止，后续步骤会在 `outputs/daily-auto-result.json` 中标记为 `skipped`。日志写入 `logs/daily-auto.log`，总结写入 `outputs/daily-auto-report.md`，本次运行报告写入 `runs/yyyy-mm-dd-HHmmss/run-report.md`。

默认不建议启用旧的 8 点 daily:auto。只有用户明确选择全自动草稿链路时，才安装每天早上 8 点运行的项目 cron：

```bash
pnpm scheduler:install
```

查看当前项目相关 cron：

```bash
pnpm scheduler:show
```

取消项目 cron：

```bash
pnpm scheduler:uninstall
```

安装后的 cron 块：

```cron
# wechat-ai-content-agent daily auto start
0 8 * * * cd /Users/Shared/AgentWork/公众号AI内容生产与草稿发布Agent/wechat-ai-content-agent && pnpm run:daily:auto >> logs/daily-auto.log 2>&1
# wechat-ai-content-agent daily auto end
```

查看日志：

```bash
tail -f logs/daily-auto.log
```

安全边界：

- cron 不会发布文章。
- cron 不会群发文章。
- cron 只会创建公众号草稿箱草稿。
- 最终发布需要人工进入公众号后台确认。
- 如果同一天已经创建草稿，任务会被 same-day lock 阻止。
- 如果要手动重复测试，才使用 `pnpm run:daily:auto -- --force`。
- 不要把 `.env` 提交到 git，也不要提交真实凭据、token、`outputs/`、`runs/` 或 `logs/daily-auto.log`。

轻量通知默认关闭。开启失败通知示例：

```bash
NOTIFY_ENABLE=true
NOTIFY_METHOD=webhook
NOTIFY_WEBHOOK_URL=https://example.com/webhook
NOTIFY_ON_FAILURE=true
NOTIFY_ON_SUCCESS=false
```

通知 payload 只包含运行状态、标题、摘要、文章标题、草稿 media_id、报告路径和人工确认要求，不写入 AppSecret、access token、APIMart key 或 MiniMax key。webhook 发送失败只记录 warning，不回滚已经完成的草稿创建逻辑。

## 8. 异常处理流程

`pnpm run:daily` 失败：

- 先看终端中失败阶段名称。
- 检查 `outputs/` 中最后生成的 report。
- 若采集阶段失败，确认 `SEARCH_ENABLE_REAL_API=false` 时 mock search 可用；真实搜索失败时先回到 mock。
- 若标题阶段失败，打开 `outputs/title-selection-report.md` 或检查候选标题是否触碰 forbidden terms / fact pack 边界。
- 若手动选题失败，确认 `inputs/manual-topic.md` 非空且包含 `Source URL`。
- 若文章、封面或 HTML 审核失败，不要跳过审核，先修复对应 pipeline 输出。
- 若真实 LLM 阶段失败，不要 fallback 到 mock 继续推草稿；先修复 MiniMax 配置、额度或响应格式。

`pnpm preflight:final` 失败：

- 打开 `outputs/final-preflight-report.md`。
- 按 Blocking Issues 逐项处理。
- 若提示本地图片路径，先把正文图片上传到微信图床或移除正文图片引用。
- 若提示封面素材缺失，先上传真实 JPG/PNG/JPEG 封面素材，或确认 `WECHAT_COVER_IMAGE_PATH` / APIMart 真实封面产物可上传。
- 若提示同日锁存在，确认不是重复写入；只有明确需要第二个真实草稿时才使用 `--force`。
- 若提示 LLM mode=mock，确认 `LLM_ENABLE_REAL_API=true`、`LLM_DRY_RUN=false`，并重新生成文章、标题和文章审核产物。

`pnpm wechat:draft:real` 失败：

- 不要重试发布或群发相关接口。
- 若提示双开关缺失，补齐 `WECHAT_API_ENABLE_REAL_DRAFT=true` 和 `WECHAT_DRAFT_ALLOW_REAL_API=true`。
- 若提示凭据缺失，补齐 `WECHAT_APP_ID` 和 `WECHAT_APP_SECRET`。
- 若微信返回 IP 白名单错误，先到公众号后台配置当前出口 IP，再重新执行最终预检和真实草稿写入。
- 若已经实际创建过草稿但本地命令失败，先登录公众号后台人工确认草稿箱状态，再决定是否需要 `--force`。

`pnpm run:daily:auto` 失败：

- 打开 `outputs/daily-auto-report.md` 查看失败步骤。
- 打开 `logs/daily-auto.log` 查看分步日志。
- 打开 `runs/yyyy-mm-dd-HHmmss/run-report.md` 查看本次自动运行报告。
- 如果失败原因是 same-day lock，说明今天已经创建过真实草稿；不要自动重跑，只有手动重复测试才使用 `--force`。
- 如果失败发生在 `preflight:final`，先按 `outputs/final-preflight-report.md` 修复，不要跳过文章审核、封面审核或 HTML 排版检查。
- 如果失败发生在 `wechat:draft:real`，不要改用发布或群发接口，只排查凭据、IP 白名单、封面素材和微信官方草稿箱 API 返回。

## 9. 验收与发版

每次发版前执行 `docs/release-checklist.md` 中的检查项。最小命令集：

```bash
pnpm typecheck
pnpm test
pnpm dashboard:build
pnpm dry-run
pnpm run:daily -- --until brief
pnpm wechat:draft:dry-run
pnpm preflight:final
```

任何一步失败都不要进入真实草稿写入。
