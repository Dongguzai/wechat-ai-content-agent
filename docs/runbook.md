# v0.1.0 Runbook

本文档用于 v0.1.0 封板后的日常运行、验收和真实草稿写入操作。除非明确进入真实草稿模式，所有命令都应保持 dry-run。

## 1. 环境准备

要求：

- Node.js >= 20
- pnpm >= 9
- 不提交 `.env`
- 不提交 `outputs/` 业务产物

首次准备：

```bash
pnpm install
cp .env.example .env
```

`.env.example` 的默认值就是安全 dry-run 默认值。真实 API key 和公众号凭据只写入本地 `.env` 或命令行环境变量。

真实草稿写入前，还要在公众号后台完成 IP 白名单配置：把当前机器或部署服务器的出口 IP 加入公众号开发配置。未配置时，获取 access token 或创建草稿通常会被微信拒绝。

## 2. 本地完整 dry-run

执行：

```bash
pnpm dry-run
```

预期结果：

- 命令退出码为 0。
- `outputs/daily-report.md` 生成。
- `outputs/article-review.json` 中 `passed` 为 `true`。
- `outputs/cover-review.json` 中 `passed` 为 `true`。
- `outputs/wechat-layout.json` 中 `compatibleWithWechat` 为 `true`。
- `outputs/wechat-draft-result.json` 为 mock 草稿结果。
- `outputs/wechat-api-preflight.json` 为官方 API 草稿预检结果。
- dry-run 下不会真实写入公众号草稿，不会发布，不会群发。

重点查看：

```bash
sed -n '1,220p' outputs/daily-report.md
sed -n '1,220p' outputs/wechat-api-draft-report.md
```

这是“生成内容”步骤。后续真实草稿写入必须基于这一步产出的文章、封面审核、HTML 排版和官方 API 预检产物。

## 3. 测试验收

封板前必须执行：

```bash
pnpm test
pnpm typecheck
```

两条命令都必须退出码为 0。若失败，先按 `docs/troubleshooting.md` 处理，不要绕过安全测试。

## 4. 真实搜索线索

默认：

```env
SEARCH_ENABLE_REAL_API=false
```

此时 Tavily / Exa 使用 mock search adapter。若要真实补充搜索线索：

```bash
SEARCH_ENABLE_REAL_API=true \
TAVILY_API_KEY=你的TavilyKey \
EXA_API_KEY=你的ExaKey \
pnpm dry-run
```

注意：

- Tavily / Exa 结果只作为线索，不作为事实来源。
- 事实表述仍以 `topic-fact-pack` 的 verified claims 和 safe wording 为准。
- 没有 key 时会回到 mock search，不应把缺 key 当作生产阻断。

## 5. 封面处理

默认：

```env
COVER_ENABLE_REAL_API=false
COVER_IMAGE_PROVIDER=apimart
COVER_IMAGE_SIZE=900x383
```

v0.1.0 默认生成本地 mock SVG 封面，并输出：

- `outputs/cover.json`
- `outputs/cover-prompt.md`
- `outputs/cover-review.json`
- `outputs/covers/`

真实公众号草稿不能使用 mock SVG 封面。进入真实草稿前，必须准备已上传的 `WECHAT_COVER_MEDIA_ID`，或提供本地真实 JPG/PNG 文件给上传脚本。

上传脚本 dry-run：

```bash
WECHAT_APP_ID=测试AppID \
WECHAT_APP_SECRET=测试AppSecret \
WECHAT_COVER_IMAGE_PATH=/absolute/path/to/cover.png \
pnpm wechat:upload-cover -- --dry-run
```

真实上传：

```bash
WECHAT_APP_ID=你的AppID \
WECHAT_APP_SECRET=你的AppSecret \
WECHAT_COVER_IMAGE_PATH=/absolute/path/to/cover.png \
pnpm wechat:upload-cover
```

成功后把输出的 `WECHAT_COVER_MEDIA_ID=...` 写入本地 `.env` 或当前 shell。

封面上传脚本只调用 `/cgi-bin/token` 和 `/cgi-bin/material/add_material?type=thumb`，用于获取 `WECHAT_COVER_MEDIA_ID`。它不会调用 `/cgi-bin/draft/add`，也不会调用 publish、freepublish、mass 或 sendall 相关接口。

## 6. 官方 API 草稿 dry-run

只生成预检和请求摘要：

```bash
pnpm wechat:draft:dry-run
```

预期输出：

- `outputs/wechat-api-preflight.json`
- `outputs/wechat-api-draft-result.json`
- `outputs/wechat-api-draft-report.md`

dry-run 必须保持：

- `WECHAT_API_ENABLE_REAL_DRAFT=false`
- `WECHAT_DRAFT_ALLOW_REAL_API=false`
- `WECHAT_DRAFT_DRY_RUN=true`

## 7. 真实创建公众号草稿

真实写入前人工检查：

- 已执行 `pnpm dry-run`。
- 已执行 `pnpm wechat:draft:dry-run` 并阅读预检报告。
- `outputs/article-review.json` 通过。
- `outputs/cover-review.json` 通过。
- `outputs/wechat-layout.json` 兼容公众号 HTML。
- 已有 `WECHAT_COVER_MEDIA_ID`，或有可上传 JPG/PNG 封面。
- 公众号后台 IP 白名单已包含当前出口 IP。
- 明确只创建草稿，最终发布必须人工登录后台完成。

真实创建草稿：

```bash
WECHAT_API_ENABLE_REAL_DRAFT=true \
WECHAT_DRAFT_ALLOW_REAL_API=true \
WECHAT_DRAFT_DRY_RUN=false \
WECHAT_APP_ID=你的AppID \
WECHAT_APP_SECRET=你的AppSecret \
WECHAT_COVER_MEDIA_ID=已上传的thumb_media_id \
pnpm wechat:draft:real
```

若使用本地封面上传路径代替 `WECHAT_COVER_MEDIA_ID`：

```bash
WECHAT_API_ENABLE_REAL_DRAFT=true \
WECHAT_DRAFT_ALLOW_REAL_API=true \
WECHAT_DRAFT_DRY_RUN=false \
WECHAT_APP_ID=你的AppID \
WECHAT_APP_SECRET=你的AppSecret \
WECHAT_COVER_IMAGE_PATH=/absolute/path/to/cover.png \
pnpm wechat:draft:real
```

真实模式仍只允许创建草稿箱草稿。任何发布、群发或最终发送动作都必须停止。

## 8. 浏览器后台操作

v0.1.0 不默认打开微信公众号后台，不保存 cookie/token，不保存登录态。若后续人工进入后台核对草稿，遵循：

- `docs/wechat-draft-browser-sop.md`
- `docs/wechat-draft-browser-checklist.md`
- `docs/wechat-draft-risk-map.md`

必须人工扫码登录。创建草稿后，人工检查标题、摘要、正文排版、封面裁切、移动端预览和链接来源；最终发布必须由人工在公众号后台操作。

## 9. 标准发布前流程

按顺序执行：

1. 准备 `.env`，只在本地保存真实 key 和公众号凭据。
2. 在公众号后台配置当前出口 IP 白名单。
3. 执行 `pnpm dry-run` 生成内容。
4. 执行 `pnpm wechat:draft:dry-run` 检查草稿 API 预检报告。
5. 用真实 JPG/PNG/JPEG 执行 `pnpm wechat:upload-cover`，获取 `WECHAT_COVER_MEDIA_ID`。
6. 双开关执行 `pnpm wechat:draft:real` 创建公众号草稿。
7. 人工登录公众号后台检查草稿。
8. 人工决定是否发布；系统不自动发布、不群发、不确认最终发送。

## 10. 封板交付检查

交付前确认：

- README 已反映 v0.1.0 当前能力。
- `docs/runbook.md` 和 `docs/troubleshooting.md` 存在。
- `.env.example` 覆盖当前代码读取的环境变量。
- `pnpm test` 通过。
- `pnpm typecheck` 通过。
- 未修改核心 pipeline、adapter、hook、type 逻辑。
- 未提交 `.env`、真实凭据、access token、cookie、登录态或 `outputs/` 业务产物。
