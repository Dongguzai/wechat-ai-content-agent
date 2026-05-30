# 公众号 AI 内容生产与草稿发布 Agent

v0.3.1 是一个本地优先、默认 dry-run 的公众号 AI 内容生产流水线。它已经串起从 AI 资讯采集、选题、事实包、文章、标题优化、审核、封面、公众号 HTML 排版，到草稿箱请求预检的完整链路，并补齐每日稳定运行所需的归档、最终预检和真实草稿运行锁。

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
9. 渲染公众号兼容 HTML；当前 v0.3.1 默认不在正文插入封面图。
10. 生成 mock 草稿产物。
11. 生成微信公众号官方 API 草稿箱请求预检和 dry-run 报告。
12. 每次 `pnpm dry-run` 或 `pnpm run:daily` 成功后，把核心产物归档到 `runs/yyyy-mm-dd-HHmmss/`，并写入 `run-report.md`。
13. 在双开关、凭据、封面素材、最终预检和安全检查全部满足时，允许创建公众号草稿箱草稿。

## 当前边界

- 默认不调用真实 Tavily / Exa、APIMart 或微信 API。
- APIMart 真实生图仍是 TODO-gated；默认只生成本地 mock SVG 封面。
- 微信真实模式只允许调用官方草稿箱创建接口。
- 不调用发布接口。
- 不调用群发接口。
- 不自动点击“发布”“群发”“确认发送”“立即发送”。
- 不默认操作微信公众号后台页面。
- 不做定时任务。
- 不接数据库。
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
```

更多操作步骤见 `docs/runbook.md`，常见问题见 `docs/troubleshooting.md`。

## 完整使用流程

1. 每日正式 dry-run，生成内容、本地草稿 dry-run、官方 API 草稿请求预览，并归档本次产物：

```bash
pnpm run:daily
```

也可以使用兼容命令：

```bash
pnpm dry-run
```

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

如果 `inputs/manual-topic.md` 存在且非空，`pnpm run:daily` 会默认优先使用它。人工选题只覆盖选题入口，仍然必须经过 fact pack、article writer、article reviewer、cover、layout、mock draft 和官方 API dry-run 预检。

## 内容质量配置

账号风格放在 `config/editorial-style.md`。当前默认风格是第三视角、旁观者分析、通俗但犀利，不写新闻通稿、不堆英文术语、不写营销号腔；文章结构固定为“冲突切入 → 事实解释 → 行业逻辑 → 影响人群 → 趋势判断”。`topic-editor` 和 `article-writer` 会读取该文件，并在报告里记录是否读取成功。

标题生成会输出：

- `outputs/title-candidates.json`
- `outputs/title-selection-report.md`

每篇文章生成 5 个标题：判断型、反差型、趋势型、普通人影响型、技术圈讨论型。每个标题都有 `spreadScore`、`accuracyScore`、`nonClickbaitScore`、`wechatFitScore`、`thesisMatchScore`、`finalScore`。最终标题会写入 `outputs/article-meta.json`，并由 `outputs/wechat.html` 使用。

人工反馈模板在 `feedback/template.json`。复制为日期文件后填写，例如 `feedback/2026-05-30.json`：

```json
{
  "date": "2026-05-30",
  "title": "文章标题",
  "published": true,
  "views": 1200,
  "likes": 18,
  "shares": 6,
  "myRating": 4,
  "topicQuality": 4,
  "titleQuality": 3,
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

## 常用脚本

| command | purpose |
| --- | --- |
| `pnpm dev` | 运行入口文件 |
| `pnpm env:check` | 检查 `.env` 格式、变量漂移、当前草稿模式和真实模式必填项 |
| `pnpm dry-run` | 执行完整本地 dry-run 流水线 |
| `pnpm run:daily` | 执行每日稳定运行流程，默认 dry-run 并归档核心产物 |
| `pnpm preflight:final` | 检查真实草稿写入前的最终条件，不调用真实微信 API |
| `pnpm wechat:upload-cover -- --dry-run` | 演练封面素材上传脚本，不调用真实微信接口 |
| `pnpm wechat:upload-cover` | 上传真实 JPG/PNG 封面素材并输出 `WECHAT_COVER_MEDIA_ID` |
| `pnpm wechat:draft:dry-run` | 生成官方 API 草稿请求预检，不调用真实微信接口 |
| `pnpm wechat:draft:real` | 在双开关和凭据齐备时创建真实公众号草稿 |
| `pnpm test` | 运行 Node test 套件 |
| `pnpm typecheck` | 运行 TypeScript 类型检查 |

## dry-run 产物

`pnpm dry-run` 会生成或更新以下业务产物：

- `outputs/raw-news.json`
- `outputs/normalized-news.json`
- `outputs/rejected-news.json`
- `outputs/candidate-news.json`
- `outputs/collection-report.md`
- `outputs/shortlisted-news.json`
- `outputs/shortlist-report.md`
- `outputs/selected-topic.json`
- `outputs/topic-selection-report.md`
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
- `outputs/wechat-api-preflight.json`
- `outputs/wechat-api-draft-result.json`
- `outputs/wechat-api-draft-report.md`
- `outputs/daily-report.md`

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
- `COVER_ENABLE_REAL_API=false`：封面走本地 mock SVG。
- `WECHAT_API_ENABLE_REAL_DRAFT=false`、`WECHAT_DRAFT_ALLOW_REAL_API=false`、`WECHAT_DRAFT_DRY_RUN=true`：官方 API 草稿写入只做预检。
- `WECHAT_FORBID_PUBLISH=true`、`WECHAT_FORBID_MASS_SEND=true`：发布和群发防线保持开启。

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

## 安全约束

- `requireSourceUrl`：资讯缺少 `url` 时立即报错。
- `forbidAutoPublish`：检测到高风险发送词时立即报错。
- `forbidWechatPublishApi`：检测到发布、群发、freepublish、mass、sendall 等 API URL 或 actionName 时立即报错。
- `forceApimartImage`：封面 provider 只能是 APIMart。
- `saveWechatDraft`：只返回 mock 草稿记录，不触发真实后台或浏览器操作。
- `saveWechatDraftApi`：默认只生成官方 API 草稿请求预览；真实模式也只允许创建草稿箱草稿。
- `.gitignore`：忽略 `.env`、`.env.*`、`.local/` 和 `outputs/` 业务产物，只允许提交 `.env.example` 与 `outputs/.gitkeep`。

封板验收以 `pnpm test` 和 `pnpm typecheck` 通过为准。
