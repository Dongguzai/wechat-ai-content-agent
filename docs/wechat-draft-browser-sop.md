# 微信公众号草稿写入浏览器 SOP

## 1. 阶段结论

本 SOP 属于第 9B-0 阶段，仅用于拆解后续真实微信公众号后台草稿写入的人工 review 流程和测试边界。

本阶段不加入 Playwright，不加入 Puppeteer，不加入任何浏览器自动化依赖，不打开 `https://mp.weixin.qq.com`，不登录公众号后台，不真实上传封面，不真实保存草稿，不发布，不群发。

## 2. 发布安全边界

- 系统只能保存草稿。
- 系统只能生成预览。
- 系统不得自动发布。
- 系统不得自动群发。
- 系统不得确认任何最终发送弹窗。
- 最终发布必须人工操作。
- 任何包含“发布”“群发”“确认发送”“立即发送”的自动化 action label 必须被 `forbidAutoPublish` 阻止。

## 3. 输入产物

- `outputs/wechat.html`
- `outputs/cover.json`
- `outputs/wechat-layout.json`
- `outputs/wechat-draft-result.json`
- `outputs/wechat-draft-report.md`

## 4. 前置检查

在进入任何真实浏览器测试前，必须人工或测试脚本只读检查以下条件：

1. `outputs/article-review.json` 的 `passed=true`。
2. `outputs/cover-review.json` 的 `passed=true`。
3. `outputs/wechat-layout.json` 的 `allowedNextStage=true`。
4. `outputs/wechat.html` 存在且非空。
5. `outputs/cover.json` 的 `imagePath` 存在，且指向的封面图文件存在。
6. `outputs/wechat-draft-result.json` 的 `mode="mock"` 且 `status="draft_saved"`。
7. `outputs/wechat-draft-result.json` 的 `allowedNextStage=false`。
8. `forbidAutoPublish` hook 已启用，并能拦截“发布”“群发”“确认发送”“立即发送”。
9. 用户明确确认进入后续 9B 真实后台测试。
10. 用户准备人工扫码登录，且理解最终发布必须人工操作。

任一检查失败，应停止，不进入真实后台测试。

## 5. 人工登录

后续 9B 如获用户明确确认，登录流程必须保持人工完成：

1. 由人工打开微信公众号后台。
2. 由人工扫码登录。
3. 不在代码中保存账号、密码、二维码、cookie、token、localStorage 或 sessionStorage。
4. 不把任何登录凭据、cookie、token、截图或敏感配置写入仓库。
5. 登录态过期时停止，等待人工重新扫码。

## 6. 新建图文草稿

后续 9B 如获用户明确确认，只允许围绕“草稿写入”进行测试：

1. 进入图文消息或草稿箱入口。
2. 新建图文。
3. 从 `outputs/article-meta.json` 读取标题。
4. 从 `outputs/wechat-layout.json` 或文章 meta 读取摘要候选；摘要为空或过长时停止并等待人工处理。
5. 粘贴 `outputs/wechat.html` 中的正文 HTML。
6. 检查正文是否进入编辑器，重点查看标题、二级标题、段落、引用、图片和分割线。
7. 上传 `outputs/cover.json` 中 `imagePath` 指向的封面图。
8. 检查封面比例、裁切和显示位置。

## 7. 保存草稿

后续 9B 的浏览器测试只能执行以下安全动作：

- 点击“保存草稿”。
- 生成预览。
- 等待人工确认。

“保存草稿”是唯一允许的保存动作；不得点击“发布”“群发”“确认发送”“立即发送”。

## 8. 明确停止点

必须在以下任一节点停止，不得继续进入发布或群发：

1. 保存草稿后必须停止。
2. 生成预览后必须停止。
3. 出现任何最终发送、发布或群发相关弹窗时必须停止。
4. 出现登录态失效、页面改版、上传失败、保存失败或未知弹窗时必须停止。
5. 必须等待人工确认。

## 9. 后续 9B 测试准入

进入后续 9B 真实浏览器草稿写入测试前，需要用户再次明确确认：

- 是否允许打开微信公众号后台。
- 是否已准备人工扫码登录。
- 是否允许在真实后台创建一篇测试草稿。
- 是否确认只保存草稿和生成预览。
- 是否确认最终发布必须人工操作。
- 是否确认不进行发布、群发或最终发送确认。
