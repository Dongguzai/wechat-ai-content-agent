# wechat-draft-publisher

负责第九阶段 9A：微信公众号草稿箱写入 dry-run，第 9B-0 阶段：真实浏览器草稿写入 SOP 设计，以及第 9B-1 阶段：真实浏览器自动化骨架和安全闸门。

本 skill 只能执行 mock / dry-run。不得调用微信公众号后台，不得启动 Playwright、Puppeteer 或任何浏览器自动化，不得打开 `https://mp.weixin.qq.com`，不得真实登录、上传封面、保存草稿、发布或群发。

## 输入

- `outputs/article.md`
- `outputs/article-meta.json`
- `outputs/article-review.json`
- `outputs/cover.json`
- `outputs/cover-review.json`
- `outputs/wechat.html`
- `outputs/wechat-layout.json`
- `outputs/wechat-layout-report.md`

## 输出

- `outputs/wechat-draft-result.json`
- `outputs/wechat-draft-report.md`

## 执行边界

只允许模拟以下动作，并且每个 action label 都必须先通过 `forbidAutoPublish` 检查：

- 检查文章审核结果
- 检查封面审核结果
- 检查 HTML 排版结果
- 创建草稿
- 填写标题
- 填写正文 HTML
- 上传封面图
- 保存草稿
- 生成预览
- 等待人工确认

如果 action label 包含以下词，必须立即抛错并阻止流程：

- 群发
- 发布
- 确认发送
- 立即发送

`保存草稿` 和 `生成预览` 是允许的 mock action label，但不得触发真实后台操作。

## 阶段门禁

写入 mock 草稿前必须确认：

- `article-review.json` 的 `passed=true`
- `cover-review.json` 的 `passed=true`
- `wechat-layout.json` 的 `allowedNextStage=true`
- `outputs/wechat.html` 存在且非空
- `cover.json` 的 `imagePath` 存在

## 结果要求

`wechat-draft-result.json` 必须声明：

- `mode="mock"`
- `status="draft_saved"`
- `allowedNextStage=false`
- `safety.autoPublishBlocked=true`
- `safety.onlyDraftSaved=true`
- `safety.requiresHumanConfirmation=true`

报告必须明确写出：系统不会自动发布，也不会自动群发；需要人工登录微信公众号后台检查草稿预览，确认无误后再手动发布。

## 9B-0 SOP 设计边界

9B-0 只允许生成文档，不允许实现或运行真实浏览器自动化。

允许输出：

- `docs/wechat-draft-browser-sop.md`
- `docs/wechat-draft-browser-checklist.md`
- `docs/wechat-draft-risk-map.md`
- `outputs/wechat-browser-sop-report.md`

禁止事项：

- 不加入 Playwright。
- 不加入 Puppeteer。
- 不加入浏览器自动化依赖。
- 不打开 `https://mp.weixin.qq.com`。
- 不真实登录公众号后台。
- 不真实上传封面。
- 不真实保存草稿。
- 不发布。
- 不群发。
- 不确认任何最终发送弹窗。
- 不写任何真实自动化执行代码。

9B-0 文档必须再次明确：

- 系统只能保存草稿。
- 系统只能生成预览。
- 系统不得自动发布。
- 系统不得自动群发。
- 系统不得确认任何最终发送弹窗。
- 最终发布必须人工操作。

## 9B-1 浏览器自动化骨架边界

9B-1 只允许实现 browser-disabled 默认计划、adapter interface、安全检查和报告输出。默认不得打开真实浏览器。

默认环境变量：

- `WECHAT_BROWSER_ENABLE_REAL=false`
- `WECHAT_BROWSER_HEADLESS=false`
- `WECHAT_BROWSER_USER_DATA_DIR=.local/wechat-browser-profile`
- `WECHAT_BROWSER_ALLOW_SAVE_DRAFT=false`
- `WECHAT_BROWSER_ALLOW_PREVIEW=false`

输出：

- `outputs/wechat-browser-draft-plan.json`
- `outputs/wechat-browser-draft-plan.md`
- `outputs/wechat-browser-safety-check.json`

强制要求：

- `WECHAT_BROWSER_ENABLE_REAL=false` 时必须返回 `browserDisabled=true`，不得打开浏览器。
- 即使后续设置 `WECHAT_BROWSER_ENABLE_REAL=true`，也必须先执行 safety check。
- `WECHAT_BROWSER_ALLOW_SAVE_DRAFT=false` 时不得点击“保存草稿”。
- `WECHAT_BROWSER_ALLOW_PREVIEW=false` 时不得生成预览。
- 所有 action label 必须先通过 `forbidAutoPublish`。
- “发布”“群发”“确认发送”“立即发送”不得出现在 browser steps 中，只能出现在 `forbiddenActions` 中。
- 不得写死账号密码。
- 不得把 cookie、token、二维码或登录态文件提交到仓库。
- 本阶段可以保留真实 DOM selector TODO，但不得写可执行的真实后台操作代码。

9B-1 默认 dry-run 的 Current phase 应为 `wechat browser draft plan only`，并明确：

- 已生成真实浏览器写入计划。
- 未打开公众号后台。
- 未真实保存草稿。
- 未发布。
- 未群发。
- 需要用户显式设置 `WECHAT_BROWSER_ENABLE_REAL=true` 才能进入真实浏览器测试。
