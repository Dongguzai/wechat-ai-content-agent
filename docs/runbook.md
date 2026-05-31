# v0.6.0 Runbook

本文档用于 v0.6.0 每日自动草稿版的每日运行、真实草稿写入、8 点定时任务、失败通知和异常处理。除非明确进入真实草稿模式，所有命令都保持 dry-run；系统不发布、不群发、不打开微信公众号后台。

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

## 2. 每日运行流程

每日默认执行：

```bash
pnpm run:daily
```

该命令会执行完整内容生产流程，并强制保持：

- `WECHAT_DRAFT_DRY_RUN=true`
- `WECHAT_API_ENABLE_REAL_DRAFT=false`
- `WECHAT_DRAFT_ALLOW_REAL_API=false`

预期结果：

- 命令退出码为 0。
- `outputs/daily-report.md` 生成。
- `outputs/title-candidates.json` 生成 5 个标题候选，并记录标题 LLM 元信息。
- `outputs/title-selection-report.md` 记录最终标题选择理由。
- `outputs/article-meta.json` 记录正文 LLM 元信息。
- `outputs/article-review.json` 中 `passed=true`。
- `outputs/cover-review.json` 中 `passed=true`。
- `outputs/wechat-layout.json` 中 `compatibleWithWechat=true` 且 `allowedNextStage=true`。
- `outputs/wechat-draft-result.json` 为 mock 草稿结果。
- `outputs/wechat-api-preflight.json` 为官方 API 草稿 dry-run 预检结果。
- 核心产物复制到 `runs/yyyy-mm-dd-HHmmss/`，并生成 `run-manifest.json` 和 `run-report.md`。

兼容命令：

```bash
pnpm dry-run
```

`pnpm dry-run` 与 `pnpm run:daily` 一样会归档成功运行产物。

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
MINIMAX_MODEL=MiniMax-M2.7
MINIMAX_MAX_COMPLETION_TOKENS=2048
MINIMAX_TEMPERATURE=0.75
ARTICLE_WRITER_PROVIDER=minimax
ARTICLE_WRITER_MODEL=MiniMax-M2.7
TITLE_GENERATOR_PROVIDER=minimax
TITLE_GENERATOR_MODEL=MiniMax-M2.7
ARTICLE_REVIEWER_PROVIDER=minimax
ARTICLE_REVIEWER_MODEL=MiniMax-M2.7
LLM_ENABLE_REAL_API=false
LLM_DRY_RUN=true
```

开启真实 MiniMax 调用：

```env
MINIMAX_API_KEY=你的MiniMaxKey
LLM_ENABLE_REAL_API=true
LLM_DRY_RUN=false
LLM_PROVIDER=minimax
```

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

人工反馈模板在 `feedback/template.json`。复制为日期文件，例如：

```bash
cp feedback/template.json feedback/2026-05-30.json
```

填写字段：

- `date`
- `title`
- `published`
- `views`
- `likes`
- `shares`
- `myRating`
- `topicQuality`
- `titleQuality`
- `articleProblems`
- `notes`

流程会读取日期最近的一份 feedback JSON，用于后续选题报告和标题评分参考。没有 feedback 文件时流程不会失败。真实 feedback JSON 默认被 `.gitignore` 忽略，只提交 `feedback/template.json`。

## 6. 真实草稿写入流程

真实写入前，先确认已经完成每日运行：

```bash
pnpm run:daily
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

## 7. 每日定时运行

每日自动草稿任务使用：

```bash
pnpm run:daily:auto
```

它按固定顺序执行：

1. `pnpm run:daily`
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

安装每天早上 8 点运行的项目 cron：

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
pnpm dry-run
pnpm run:daily
pnpm wechat:draft:dry-run
pnpm preflight:final
```

任何一步失败都不要进入真实草稿写入。
