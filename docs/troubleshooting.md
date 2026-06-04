# v0.3.1 Troubleshooting

本文档收敛 v0.3.1 常见阻断。处理原则是先保持 dry-run 和安全开关，再定位具体产物或配置。

## 1. 依赖或运行环境

### `pnpm: command not found`

安装或启用 pnpm，并确认版本 >= 9：

```bash
pnpm --version
```

### Node 版本过低

本项目要求 Node.js >= 20。低版本可能缺少内置 `fetch`、`Response` 或 ESM 行为不一致：

```bash
node --version
```

## 2. dry-run 失败

### RSS 抓取失败或数量不足

现象：

- 采集日志里出现 RSS fetch、parse 或候选数量不足相关 warning。
- `outputs/collection-report.md` 中 RSS 数量偏低。

处理：

- 保持 dry-run 继续观察候选池；当前链路会用 mock RSS / global search 线索作为 fallback 补齐候选。
- 检查网络、RSS 源可用性和 `src/config/sources.ts` 中源配置。
- 不要因为单个 RSS 源失败而跳过 source url 校验。

### 缺少 source url

现象：

- 流水线或测试报 `source url`、`requireSourceUrl` 相关错误。

处理：

- 检查输入新闻是否包含 `url`。
- 不要用没有来源链接的资讯进入候选池。

### 文章审核未通过

现象：

- `Article review has not passed; cover generation is blocked.`
- `outputs/article-review.json` 中 `passed=false`。

处理：

- 查看 `outputs/article-review-report.md`。
- 回到选题、事实包或文章生成阶段修正风险表述。
- 不要跳过文章审核直接生成封面或草稿。

### 封面审核未通过

现象：

- `outputs/cover-review.json` 中 `passed=false`。
- 报 provider、尺寸、品牌标识、具体价格、绝对替代等问题。

处理：

- 保持 `COVER_IMAGE_PROVIDER=apimart`。
- 保持 `COVER_IMAGE_SIZE=900x383`。
- 避免真实品牌标识、官方产品标识、具体价格数字、免费平替和完全替代表述。
- 重新执行 `pnpm dry-run`。

### `COVER_IMAGE_SIZE must be 900x383`

处理：

```env
COVER_IMAGE_SIZE=900x383
```

v0.3.1 只接受公众号封面目标尺寸 `900x383`。

### `tsx` IPC 或临时目录权限问题

现象：

- `node --import tsx ...` 报 IPC、permission denied、EACCES、EPERM 或临时目录相关错误。

处理：

- 确认当前用户可写系统临时目录和项目目录。
- 清理损坏的临时缓存后重试。
- 保持使用 `pnpm` 脚本入口，不要绕过 `node --import tsx` 的既有运行方式。

## 3. 搜索 API

### 真实搜索没有被调用

检查：

```env
SEARCH_ENABLE_REAL_API=true
TAVILY_API_KEY=...
EXA_API_KEY=...
```

说明：

- `SEARCH_ENABLE_REAL_API=false` 时走 mock search。
- 缺少某个 key 时，对应 adapter 会保守回到 mock。
- 搜索结果只是线索，不是事实来源。

## 3.1 云端简报 cron

### `/api/cron/generate-brief` 返回 `write EPROTO` 或 `SSL/TLS handshake failure`

现象：

- Vercel 返回 500。
- 响应或日志里出现 `write EPROTO`、`ssl/tls alert handshake failure`。

处理：

- 先确认已部署新版代码；新版响应会包含 `step`，例如 `db.connect`、`r2.uploadBriefReport` 或 `config.validate`。
- 如果 `step=db.connect`，检查 `DATABASE_URL` 必须是 Neon/Postgres 连接串，协议为 `postgres://` 或 `postgresql://`，不要填 HTTP 控制台链接，也不要设置 `sslmode=disable`。
- 如果 `step=r2.uploadBriefReport` 或 `step=config.validate`，检查 R2 配置：`R2_ACCOUNT_ID` 必须是 Cloudflare 账户概览里的 32 位十六进制 account id，上传 endpoint 固定为 `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`；不要把 `cfat_` API token、Access Key、bucket 名、`R2_PUBLIC_BASE_URL` 或自定义域名填进 `R2_ACCOUNT_ID`。
- 如果错误类似 `Bucket name shouldn't contain '/'`，说明 `R2_BUCKET` 填成了 URL 或整行环境变量；`R2_BUCKET` 只能是 bucket 名，例如 `briefs`，不能是 `R2_ENDPOINT=https://...`。
- 可访问 `GET /api/health/r2` 做最小 R2 写入检查；响应会显示脱敏 account id、endpoint host、bucket 和 key 是否存在，不会返回 access key 或 secret。
- 本地可先运行 `pnpm env:check` 做形态检查；该命令不会调用 Neon、R2、微信或 MiniMax。

## 4. APIMart 封面

### `COVER_ENABLE_REAL_API=true requires APIMART_API_KEY`

处理：

```env
APIMART_API_KEY=...
APIMART_IMAGE_API_URL=https://...
COVER_ENABLE_REAL_API=true
```

### `COVER_ENABLE_REAL_API=true requires APIMART_IMAGE_API_URL`

处理：

```env
APIMART_IMAGE_API_URL=https://...
COVER_ENABLE_REAL_API=true
```

说明：

- APIMart 真实生图请求体只发送 `model`、`prompt`、`n`、`size`、`resolution`。
- 当前 `APIMART_IMAGE_SIZE` 固定为 `16:9`，`APIMART_IMAGE_RESOLUTION` 固定为 `2k`。
- `APIMART_COVER_STYLE` 会保留 warm friendly、story-driven、clean composition、clear subject 等方向，但会把具体工作室名称替换为安全的动画电影质感描述。
- 真实模式必须返回或下载到 PNG/JPG 图片字节；失败时不会 fallback mock。

## 5. 微信封面上传

### `WECHAT_COVER_IMAGE_PATH must be a JPG, PNG, or JPEG image`

处理：

- 使用 `.jpg`、`.jpeg` 或 `.png`。
- 不要使用 mock SVG 封面上传真实微信素材。

### `WECHAT_COVER_IMAGE_PATH must point to an existing image file`

处理：

- 使用绝对路径。
- 确认文件存在且可读。

### 上传成功但担心泄漏凭据

脚本只应输出：

```text
WECHAT_COVER_MEDIA_ID=...
```

如错误信息中出现 app secret、access token 或 media id 泄漏，停止使用并先修复脱敏逻辑。

## 6. 微信官方 API 草稿

### `pnpm wechat:draft:real requires WECHAT_API_ENABLE_REAL_DRAFT=true and WECHAT_DRAFT_ALLOW_REAL_API=true`

真实草稿必须双开关：

```env
WECHAT_API_ENABLE_REAL_DRAFT=true
WECHAT_DRAFT_ALLOW_REAL_API=true
WECHAT_DRAFT_DRY_RUN=false
```

任一开关缺失都会阻断真实调用。

### `pnpm preflight:final` 被 same-day lock 阻断

现象：

- `outputs/final-preflight-report.md` 的 Blocking Issues 出现 `same-day real draft lock`。
- 文案为 `same-day real draft lock exists: a real draft was already created today.`。

处理：

- 先确认当天是否已经真实创建过公众号草稿，不要用重试绕过锁。
- 只有明确需要同一天创建第二个真实草稿时，先执行 `pnpm preflight:final -- --force`。
- 最终真实写入也必须显式使用 `pnpm wechat:draft:real -- --force`。
- `--force` 只覆盖同日草稿锁，不会放宽文章审核、封面审核、HTML 排版、草稿 API 或发布/群发安全检查。

### `WECHAT_APP_ID is required` 或 `WECHAT_APP_SECRET is required`

处理：

```env
WECHAT_APP_ID=...
WECHAT_APP_SECRET=...
```

不要把这些值提交到 git，也不要写进前端公开变量。

### `WECHAT_COVER_MEDIA_ID` 缺失

现象：

- 最终预检出现 `cover media id present` 阻断。
- 报错包含 `WECHAT_COVER_MEDIA_ID must be present before final real-draft preflight.`。

处理：

- 真实草稿封面必须通过草稿请求中的 `thumb_media_id` 设置。
- 先用真实 JPG/PNG/JPEG 封面执行 `pnpm wechat:upload-cover`，保存输出的 `WECHAT_COVER_MEDIA_ID=...`。
- 只做 `pnpm wechat:draft:dry-run` 时可以没有真实 media id；进入 `pnpm preflight:final` 和真实草稿前必须补齐。
- 不要把普通图片 URL、mock SVG 路径或本地文件路径当作 `WECHAT_COVER_MEDIA_ID`。

### `Mock SVG cover blocks real WeChat draft creation`

真实草稿不接受 mock SVG。二选一：

- 设置已上传的 `WECHAT_COVER_MEDIA_ID`。
- 设置真实 JPG/PNG 的 `WECHAT_COVER_IMAGE_PATH`，让草稿脚本先上传封面素材。

### 正文图片破图，或预检提示本地图片路径

现象：

- `pnpm preflight:final` 提示 `html has no local image paths`。
- 人工打开公众号草稿后正文图片破图。
- `outputs/wechat.html` 中出现 `outputs/covers/...`、`/Users/...`、`file://...`、相对路径或本地图片文件名。

处理：

- 本地图片不能直接进入微信正文 HTML；微信编辑器无法读取本机 `outputs/` 或 `/Users/` 路径。
- 正文图片需要先上传到微信可访问的图片地址，再把 HTML 里的 `img src` 替换为微信返回的 URL。
- 当前封面不插入正文；封面只通过 `WECHAT_COVER_MEDIA_ID` 对应的 `thumb_media_id` 设置。
- 修正 HTML 后重新执行 `pnpm wechat:draft:dry-run` 和 `pnpm preflight:final`。

### 微信返回 `invalid appid`

处理：

- 检查 `WECHAT_APP_ID` 是否来自当前公众号后台，且没有多余空格、引号或复制错误。
- 检查当前 shell 是否用旧变量覆盖了 `.env`；命令行和 shell 变量优先级高于 `.env`。
- 确认 `WECHAT_APP_ID` 与 `WECHAT_APP_SECRET` 属于同一个公众号。
- 不要在日志、文档或 issue 中粘贴完整 AppSecret。

### 微信返回 IP 白名单错误

处理：

- 在公众号后台把当前机器或服务器的出口 IP 加入 IP 白名单。
- 如果本地网络、代理、云主机或 CI 出口变化，重新确认出口 IP。
- IP 白名单修正后，重新执行 `pnpm preflight:final`，确认通过后再执行真实草稿写入。
- 不要因为白名单失败而改用发布、群发或浏览器自动化路径。

### access_token 获取失败

现象：

- 报 `WeChat access token request failed`。
- 微信返回 credential、secret、IP whitelist 或 token 相关 errcode。

处理：

- 检查 `WECHAT_APP_ID` 和 `WECHAT_APP_SECRET` 是否正确且同属当前公众号。
- 检查公众号后台 IP 白名单。
- 检查 `WECHAT_API_BASE=https://api.weixin.qq.com` 是否被误改。
- 不要在日志或文档中粘贴完整 AppSecret 或 access token。

### `thumb_media_id` 无效

现象：

- 草稿创建返回 media id、thumb media id、invalid media_id 或素材类型相关错误。

处理：

- 重新用真实 JPG/PNG/JPEG 执行 `pnpm wechat:upload-cover`。
- 确认使用的是上传封面素材后输出的 `WECHAT_COVER_MEDIA_ID`。
- 不要把普通图片 URL、mock SVG 路径或过期 media id 当作 thumb media id。

### 误把防发布开关关掉

现象：

- `WECHAT_FORBID_PUBLISH must not be false.`
- `WECHAT_FORBID_MASS_SEND must not be false.`

处理：

```env
WECHAT_FORBID_PUBLISH=true
WECHAT_FORBID_MASS_SEND=true
```

真实模式也不能关闭发布和群发防线。

### 禁止发布/群发接口

系统禁止 publish、freepublish、mass、sendall，以及“发布”“群发”“确认发送”“立即发送”等最终发送动作。封面上传脚本只能获取 token 并上传 thumb 素材；草稿脚本真实模式也只能调用 draft/add 创建草稿。发现任何发布或群发相关接口调用，应立即停止并修复。

## 7. 微信后台浏览器

v0.3.1 不默认操作微信公众号后台。若看到浏览器相关阻断：

- `WECHAT_BROWSER_ENABLE_REAL=false` 表示不会打开真实后台。
- `WECHAT_BROWSER_ALLOW_SAVE_DRAFT=false` 表示不会点击保存草稿。
- `WECHAT_BROWSER_ALLOW_PREVIEW=false` 表示不会生成预览。

需要人工后台核对时，先读：

- `docs/wechat-draft-browser-sop.md`
- `docs/wechat-draft-browser-checklist.md`
- `docs/wechat-draft-risk-map.md`

出现“发布”“群发”“确认发送”“立即发送”相关按钮或弹窗时必须停止。

### HTML 被公众号过滤

现象：

- 人工打开草稿后发现 `section`、`blockquote`、`hr`、inline style 或图片样式被公众号编辑器过滤。
- 预览与 `outputs/wechat.html` 不一致。

处理：

- 先人工检查草稿和移动端预览。
- 若内容丢失或排版错乱，回到 HTML 排版阶段调整到公众号兼容子集。
- 不要因为预览可见就继续自动发布；最终发布必须人工确认。

## 8. 输出产物看起来陈旧

`pnpm dry-run` 会复用已通过审核且路径一致的封面产物。若要重新生成封面相关产物，可先人工清理旧的 `outputs/cover.json`、`outputs/cover-review.json`、`outputs/cover-prompt.md` 和 `outputs/covers/`，再执行 dry-run。

不要清理或提交 `.env`、真实凭据、cookie、token 或登录态文件。

## 9. 封板测试失败

按顺序执行：

```bash
pnpm test
pnpm typecheck
```

若测试失败：

- 先读失败用例名称。
- 优先检查安全边界测试。
- 不要为了通过测试放宽发布、群发、真实 API 或凭据脱敏约束。
- 修复后重新运行两条验收命令。
