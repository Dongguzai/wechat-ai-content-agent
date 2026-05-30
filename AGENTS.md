# Agent 工作说明

本项目当前处于 v0.1.0 封板阶段：本地优先、默认 dry-run，已经串起 AI 资讯采集、编辑初筛、主选题、事实包、公众号文章、文章审核、封面、公众号 HTML 排版、mock 草稿和微信公众号官方 API 草稿箱请求预检。

默认运行不得调用真实微信写入接口，不得打开微信公众号后台，不得发布，不得群发。真实创建公众号草稿必须由用户显式开启双开关，并且只允许通过微信公众号官方草稿箱 API 创建草稿；最终发布仍必须人工完成。

## 必守边界

- 不自动发布公众号文章。
- 不自动群发公众号文章。
- 不点击“群发”。
- 不点击“发布”。
- 不点击“确认发送”。
- 不点击“立即发送”。
- 默认不调用微信公众号后台。
- 默认不调用 APIMart。
- 默认不做浏览器自动化。
- 默认不做定时任务。
- 默认不接数据库。
- 不把输出写到 `outputs/` 之外，除非用户明确要求。
- 不提交 `.env`、真实凭据、access token、cookie、登录态或 `outputs/` 业务产物。
- Tavily / Exa 只能通过 `src/adapters/` 接入；默认 `SEARCH_ENABLE_REAL_API=false` 时必须走 mock search。

## Safety / Guardrails / 安全边界

公众号发布相关能力必须遵守以下强约束：

- 公众号相关步骤只允许保存草稿、生成预览、生成请求预检、等待人工确认。
- 真实微信 API 模式只允许调用草稿箱创建相关接口。
- 禁止调用 publish、freepublish、mass、sendall 或其他发布 / 群发接口。
- 如果后续浏览器自动化中出现高风险按钮或动作，必须立即停止并报错。

实现层面要求：

- `saveWechatDraft` 必须保持 mock 保存草稿，不得调用公众号后台。
- `saveWechatDraftApi` 默认只生成请求预览；真实模式也只能创建草稿箱草稿。
- 不得加入真实发布、群发、确认发送逻辑。
- 执行任何公众号草稿相关步骤前，必须保留 `forbidAutoPublish` 风险词检查。
- 执行任何微信官方 API 调用前，必须保留 `forbidWechatPublishApi` / draft-only guard。
- APIMart 真实生图在 API 合约确认前必须保持 TODO-gated，不能伪造成功。

## 代码约定

- 使用 TypeScript、pnpm、ESM。
- pipeline 步骤保持独立模块，方便后续替换为真实实现。
- 核心数据结构必须放在 `src/types/`。
- 外部服务必须通过 `src/adapters/` 封装。
- 新增能力时先补类型，再接 pipeline。
- 业务产物写入 `outputs/`，仓库只保留 `outputs/.gitkeep`。

## v0.1.0 验收

运行：

```bash
pnpm dry-run
pnpm wechat:draft:dry-run
pnpm test
pnpm typecheck
```

预期：

- `pnpm dry-run` 生成完整本地 dry-run 产物。
- `outputs/article-review.json` 中 `passed=true`。
- `outputs/cover-review.json` 中 `passed=true`。
- `outputs/wechat-layout.json` 中 `compatibleWithWechat=true` 且 `allowedNextStage=true`。
- `outputs/wechat-draft-result.json` 为 mock 草稿结果。
- `outputs/wechat-api-preflight.json` 为官方 API 草稿预检结果。
- dry-run 下不会真实写入公众号草稿，不会发布，不会群发。

## 真实草稿前置条件

只有用户明确要求进入真实草稿创建时，才允许执行真实微信草稿 API。必须同时满足：

- `WECHAT_API_ENABLE_REAL_DRAFT=true`。
- `WECHAT_DRAFT_ALLOW_REAL_API=true`。
- `WECHAT_DRAFT_DRY_RUN=false`。
- `WECHAT_APP_ID` / `WECHAT_APP_SECRET` 存在。
- 公众号后台 IP 白名单已包含当前出口 IP。
- 已有 `WECHAT_COVER_MEDIA_ID`，或提供真实 JPG/PNG/JPEG 封面路径用于上传。
- 文章审核、封面审核、HTML 排版检查全部通过。
- 明确只创建草稿；最终发布必须人工登录微信公众号后台完成。
