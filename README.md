# 公众号 AI 内容生产与草稿发布 Agent

v0.1.1 是一个本地优先、默认 dry-run 的公众号 AI 内容生产流水线。它已经串起从 AI 资讯采集、选题、事实包、文章、审核、封面、公众号 HTML 排版，到草稿箱请求预检的完整链路。

默认运行不会调用真实微信写入接口，不会打开微信公众号后台，不会发布，不会群发。真实创建公众号草稿必须显式打开双开关，并通过官方草稿箱 API 创建草稿，最终发布仍然只能人工完成。

## 能力范围

1. 从 RSS 源采集 AI 资讯，并用 Tavily / Exa global search 线索补充候选。
2. normalize、hard rejection、去重并生成候选池。
3. 进行编辑筛选、选题、事实包构建和安全表达约束。
4. 生成公众号文章、文章审核报告、封面 prompt / mock 封面和封面审核报告。
5. 渲染公众号兼容 HTML；当前 v0.1.1 默认不在正文插入封面图。
6. 生成 mock 草稿产物。
7. 生成微信公众号官方 API 草稿箱请求预检和 dry-run 报告。
8. 在双开关、凭据、封面素材和安全检查全部满足时，允许创建公众号草稿箱草稿。

## 当前边界

- 默认不调用真实 Tavily / Exa、APIMart 或微信 API。
- APIMart 真实生图在 v0.1.0 仍是 TODO-gated；默认只生成本地 mock SVG 封面。
- 微信真实模式只允许调用官方草稿箱创建接口。
- 不调用发布接口。
- 不调用群发接口。
- 不自动点击“发布”“群发”“确认发送”“立即发送”。
- 不默认操作微信公众号后台页面。
- 不做定时任务。
- 不接数据库。
- 所有业务产物写入 `outputs/`。

## 快速开始

```bash
pnpm install
cp .env.example .env
pnpm env:check
pnpm dry-run
```

常规验收：

```bash
pnpm test
pnpm typecheck
```

更多操作步骤见 `docs/runbook.md`，常见问题见 `docs/troubleshooting.md`。

## 完整使用流程

1. 生成内容和本地产物：

```bash
pnpm dry-run
```

2. 预检公众号官方 API 草稿请求，不真实写入：

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

4. 创建公众号草稿箱草稿：

```bash
WECHAT_API_ENABLE_REAL_DRAFT=true \
WECHAT_DRAFT_ALLOW_REAL_API=true \
WECHAT_DRAFT_DRY_RUN=false \
WECHAT_APP_ID=你的AppID \
WECHAT_APP_SECRET=你的AppSecret \
WECHAT_COVER_MEDIA_ID=已上传的thumb_media_id \
pnpm wechat:draft:real
```

公众号封面只通过草稿请求里的 `thumb_media_id` 设置，也就是上一步保存的 `WECHAT_COVER_MEDIA_ID`。它不会再被重复插入正文 HTML。

5. 人工登录公众号后台检查草稿，再由人工决定是否发布。

## 常用脚本

| command | purpose |
| --- | --- |
| `pnpm dev` | 运行入口文件 |
| `pnpm env:check` | 检查 `.env` 格式、变量漂移和真实模式必填项 |
| `pnpm dry-run` | 执行完整本地 dry-run 流水线 |
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

`outputs/.gitkeep` 只是目录占位文件，不是业务产物。

## 公众号图片策略

- 公众号封面通过官方草稿接口的 `thumb_media_id` 设置，对应本项目中的 `WECHAT_COVER_MEDIA_ID`。
- 当前 v0.1.1 默认 `renderWechatHtml.ts` 中 `INSERT_COVER_IN_CONTENT=false`，因此 `outputs/wechat.html` 顶部不会自动插入 `cover.json` 的 `imagePath`。
- 正文内图片不能使用本地路径、`outputs/covers` 路径或 `/Users/` 这类机器路径。需要先通过微信 `uploadimg` 接口上传，再把正文 HTML 中的图片地址替换为微信返回的 URL。

## 真实草稿写入

真实创建公众号草稿前需要：

- 公众号 `AppID` / `AppSecret`
- 当前机器或服务器 IP 已加入公众号后台 IP 白名单
- 已上传的 `WECHAT_COVER_MEDIA_ID`，或本地真实 JPG/PNG 封面图片路径；最终草稿封面通过 `thumb_media_id` 设置
- `outputs/article-review.json` 通过
- `outputs/cover-review.json` 通过
- `outputs/wechat-layout.json` 显示兼容公众号 HTML
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
- `scripts/`：命令行运行脚本。
- `tests/`：Node test 测试。
- `docs/`：运行、排障和微信草稿风控文档。
- `outputs/`：dry-run 产物目录。

## 安全约束

- `requireSourceUrl`：资讯缺少 `url` 时立即报错。
- `forbidAutoPublish`：检测到高风险发送词时立即报错。
- `forbidWechatPublishApi`：检测到发布、群发、freepublish、mass、sendall 等 API URL 或 actionName 时立即报错。
- `forceApimartImage`：封面 provider 只能是 APIMart。
- `saveWechatDraft`：只返回 mock 草稿记录，不触发真实后台或浏览器操作。
- `saveWechatDraftApi`：默认只生成官方 API 草稿请求预览；真实模式也只允许创建草稿箱草稿。
- `.gitignore`：忽略 `.env`、`.env.*`、`.local/` 和 `outputs/` 业务产物，只允许提交 `.env.example` 与 `outputs/.gitkeep`。

封板验收以 `pnpm test` 和 `pnpm typecheck` 通过为准。
