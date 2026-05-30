# v0.2.0 Runbook

本文档用于 v0.2.0 稳定生产版的每日运行、真实草稿写入和异常处理。除非明确进入真实草稿模式，所有命令都保持 dry-run；系统不发布、不群发、不打开微信公众号后台。

## 1. 环境准备

要求：

- Node.js >= 20
- pnpm >= 9
- 不提交 `.env`
- 不提交 `outputs/` 或 `runs/` 业务产物

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
- `outputs/article-review.json` 中 `passed=true`。
- `outputs/cover-review.json` 中 `passed=true`。
- `outputs/wechat-layout.json` 中 `compatibleWithWechat=true` 且 `allowedNextStage=true`。
- `outputs/wechat-draft-result.json` 为 mock 草稿结果。
- `outputs/wechat-api-preflight.json` 为官方 API 草稿 dry-run 预检结果。
- 核心产物复制到 `runs/yyyy-mm-dd-HHmmss/`，并生成 `run-manifest.json`。

兼容命令：

```bash
pnpm dry-run
```

`pnpm dry-run` 与 `pnpm run:daily` 一样会归档成功运行产物。

## 3. 真实草稿写入流程

真实写入前，先确认已经完成每日运行：

```bash
pnpm run:daily
pnpm wechat:draft:dry-run
```

准备封面素材。真实草稿必须有 `WECHAT_COVER_MEDIA_ID`：

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
- `WECHAT_COVER_MEDIA_ID` 存在。
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

## 4. 异常处理流程

`pnpm run:daily` 失败：

- 先看终端中失败阶段名称。
- 检查 `outputs/` 中最后生成的 report。
- 若采集阶段失败，确认 `SEARCH_ENABLE_REAL_API=false` 时 mock search 可用；真实搜索失败时先回到 mock。
- 若文章、封面或 HTML 审核失败，不要跳过审核，先修复对应 pipeline 输出。

`pnpm preflight:final` 失败：

- 打开 `outputs/final-preflight-report.md`。
- 按 Blocking Issues 逐项处理。
- 若提示本地图片路径，先把正文图片上传到微信图床或移除正文图片引用。
- 若提示 `WECHAT_COVER_MEDIA_ID` 缺失，先上传真实 JPG/PNG/JPEG 封面素材。
- 若提示同日锁存在，确认不是重复写入；只有明确需要第二个真实草稿时才使用 `--force`。

`pnpm wechat:draft:real` 失败：

- 不要重试发布或群发相关接口。
- 若提示双开关缺失，补齐 `WECHAT_API_ENABLE_REAL_DRAFT=true` 和 `WECHAT_DRAFT_ALLOW_REAL_API=true`。
- 若提示凭据缺失，补齐 `WECHAT_APP_ID` 和 `WECHAT_APP_SECRET`。
- 若微信返回 IP 白名单错误，先到公众号后台配置当前出口 IP，再重新执行最终预检和真实草稿写入。
- 若已经实际创建过草稿但本地命令失败，先登录公众号后台人工确认草稿箱状态，再决定是否需要 `--force`。

## 5. 验收与发版

每次发版前执行 `docs/release-checklist.md` 中的检查项。最小命令集：

```bash
pnpm typecheck
pnpm test
pnpm dry-run
pnpm wechat:draft:dry-run
pnpm preflight:final
```

任何一步失败都不要进入真实草稿写入。
