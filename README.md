# 公众号 AI 内容生产与草稿发布 Agent

第二阶段聚焦 AI 资讯采集，用 RSS 作为主干，并用 Tavily / Exa global_search 作为补充线索：

1. 从 RSS 源抓取 AI 资讯
2. 在默认 mock search 模式下补充 Tavily / Exa 搜索线索
3. 在 `SEARCH_ENABLE_REAL_API=true` 且提供 API key 时真实调用 Tavily / Exa
4. normalize、hard rejection、去重并生成 20 条候选池
5. 输出 raw、normalized、rejected、candidate 和 collection report

## 当前边界

- 默认不调用微信 API；真实写入草稿箱必须显式打开双开关
- 真实模式只允许创建公众号草稿箱草稿
- 不调用发布接口
- 不调用群发接口
- 不操作微信公众号后台页面
- 不做浏览器自动化
- 不做定时任务
- 不接数据库
- 所有结果写入 `outputs/`

## 快速开始

```bash
pnpm install
pnpm dry-run
```

dry-run 完成后会生成：

- `outputs/raw-news.json`
- `outputs/normalized-news.json`
- `outputs/rejected-news.json`
- `outputs/candidate-news.json`
- `outputs/collection-report.md`

`outputs/.gitkeep` 只是目录占位文件，不是 dry-run 业务产物。

dry-run 业务产物包括：

- `outputs/raw-news.json`
- `outputs/normalized-news.json`
- `outputs/rejected-news.json`
- `outputs/candidate-news.json`
- `outputs/collection-report.md`
- `outputs/latest-news.json`
- `outputs/selected-topic.json`
- `outputs/article.md`
- `outputs/article-review.json`
- `outputs/cover.json`
- `outputs/wechat.html`
- `outputs/wechat-api-preflight.json`
- `outputs/wechat-api-draft-result.json`
- `outputs/wechat-api-draft-report.md`
- `outputs/daily-report.md`

## 脚本

```bash
pnpm dev
pnpm dry-run
pnpm wechat:draft:dry-run
pnpm wechat:draft:real
pnpm test
pnpm typecheck
```

## 通过微信公众号官方 API 写入草稿箱

第 9C 阶段使用微信公众号官方 API 创建图文草稿。默认只 dry-run，生成 `outputs/wechat-api-preflight.json`、`outputs/wechat-api-draft-result.json` 和 `outputs/wechat-api-draft-report.md`，不调用微信 API。

真实写入前需要：

- 公众号 `AppID` / `AppSecret`
- 在公众号后台配置当前机器或服务器的 IP 白名单
- 准备 `WECHAT_COVER_MEDIA_ID`，或提供真实 JPG/PNG 封面图片路径
- 不要把 `.env` 提交到 git
- 不要把 `WECHAT_APP_ID`、`WECHAT_APP_SECRET`、`WECHAT_COVER_MEDIA_ID` 写进前端可见变量、HTML、客户端 bundle 或 `NEXT_PUBLIC_` / `VITE_` / `PUBLIC_` 前缀变量

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

如果没有 `WECHAT_COVER_MEDIA_ID`，可以用 `WECHAT_COVER_IMAGE_PATH=/absolute/path/to/cover.png` 上传真实 JPG/PNG 封面素材。mock SVG 封面不会进入真实草稿箱写入。

系统只会创建草稿，不会发布，不会群发。最终发布必须人工登录公众号后台确认。

## 项目结构

- `src/pipeline/`：每个流水线步骤的独立模块
- `src/types/`：核心类型定义
- `src/mock/`：第一阶段模拟数据
- `src/hooks/`：安全约束
- `src/adapters/`：未来外部服务 adapter 预留目录
- `src/skills/`：各子任务的技能说明
- `outputs/`：dry-run 产物目录

## 安全约束

- `requireSourceUrl`：资讯缺少 `url` 时立即报错
- `forbidAutoPublish`：检测到高风险发送词时立即报错
- `forbidWechatPublishApi`：检测到发布、群发、freepublish、mass、sendall 等 API URL 或 actionName 时立即报错
- `saveWechatDraft`：当前只返回 mock 草稿记录，不触发真实后台或浏览器操作
- `saveWechatDraftApi`：默认只生成官方 API 草稿请求预览；真实模式也只允许创建草稿箱草稿
- `.gitignore`：忽略 `.env`、`.env.*` 和 `.local/`，只允许提交 `.env.example`
- 禁止自动群发、自动发布、点击“群发”“发布”“确认发送”“立即发送”
- 禁止把公众号凭据放入前端公开环境变量或客户端代码
- 公众号相关步骤只允许保存草稿、生成预览、等待人工确认
