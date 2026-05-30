# WeChat Browser Draft Plan

## 1. 当前模式

browser-real

## 2. 是否会打开真实浏览器

是，但本 9B-1 骨架只生成计划；真实 DOM selector 仍为 TODO。

## 3. 是否允许保存草稿

是

## 4. 是否允许生成预览

是

## 5. 操作步骤

- preflight-artifacts: 前置产物检查 | allowed=true | requiresHumanAction=false | safetyCheck=passed | Read-only artifact and SOP check.
- open-wechat-admin: 打开公众号后台 | allowed=true | requiresHumanAction=false | safetyCheck=passed | Allowed only inside the future real-browser wrapper. DOM selectors remain TODO in 9B-1.
- wait-human-scan-login: 等待人工扫码登录 | allowed=true | requiresHumanAction=true | safetyCheck=passed | Requires human QR-code scan. No credentials, cookie, or token may be stored.
- enter-draft-page: 进入图文/草稿页面 | allowed=true | requiresHumanAction=false | safetyCheck=passed | Allowed only inside the future real-browser wrapper. DOM selectors remain TODO in 9B-1.
- create-new-article: 新建图文 | allowed=true | requiresHumanAction=false | safetyCheck=passed | Allowed only inside the future real-browser wrapper. DOM selectors remain TODO in 9B-1.
- fill-title: 填写标题 | allowed=true | requiresHumanAction=false | safetyCheck=passed | Allowed only inside the future real-browser wrapper. DOM selectors remain TODO in 9B-1.
- paste-html: 粘贴正文 HTML | allowed=true | requiresHumanAction=false | safetyCheck=passed | Allowed only inside the future real-browser wrapper. DOM selectors remain TODO in 9B-1.
- upload-cover: 上传封面图 | allowed=true | requiresHumanAction=false | safetyCheck=passed | Allowed only inside the future real-browser wrapper. DOM selectors remain TODO in 9B-1.
- fill-digest: 填写摘要 | allowed=true | requiresHumanAction=false | safetyCheck=passed | Allowed only inside the future real-browser wrapper. DOM selectors remain TODO in 9B-1.
- save-draft: 保存草稿 | allowed=true | requiresHumanAction=false | safetyCheck=passed | Allowed only inside the future real-browser wrapper. DOM selectors remain TODO in 9B-1.
- generate-preview: 生成预览 | allowed=true | requiresHumanAction=false | safetyCheck=passed | Allowed only inside the future real-browser wrapper. DOM selectors remain TODO in 9B-1.
- stop-for-human-confirmation: 停止并等待人工确认 | allowed=true | requiresHumanAction=true | safetyCheck=passed | Mandatory stop point. Wait for human confirmation and do not continue to publish or mass send.

## 6. 人工介入点

- 用户显式设置 WECHAT_BROWSER_ENABLE_REAL=true
- 用户准备人工扫码登录
- 用户显式设置 WECHAT_BROWSER_ALLOW_SAVE_DRAFT=true 后才允许保存草稿
- 用户显式设置 WECHAT_BROWSER_ALLOW_PREVIEW=true 后才允许生成预览
- 保存草稿或生成预览后停止并等待人工确认
- 最终发布必须人工操作

## 7. 禁止动作

- 群发
- 发布
- 确认发送
- 立即发送

## 8. 安全检查结果

- passed: true
- realBrowserEnabled: true
- allowSaveDraft: true
- allowPreview: true
- articleReviewPassed: true
- coverReviewPassed: true
- layoutAllowedNextStage: true
- forbiddenActionsBlocked: true
- credentialsStored: false
- cookieTokenCommitted: false

### issues

- none

## 9. 下一步需要用户明确确认的事项

- 是否允许设置 WECHAT_BROWSER_ENABLE_REAL=true 并打开微信公众号后台。
- 是否已准备人工扫码登录。
- 是否允许设置 WECHAT_BROWSER_ALLOW_SAVE_DRAFT=true 后真实点击保存草稿。
- 是否允许设置 WECHAT_BROWSER_ALLOW_PREVIEW=true 后生成预览。
- 是否确认不保存账号密码、cookie、token 或二维码到仓库。
- 是否确认系统不得自动发布、不得自动群发、不得确认任何最终发送弹窗。

## 10. 发布边界

- 系统只能保存草稿。
- 系统只能生成预览。
- 系统不得自动发布。
- 系统不得自动群发。
- 系统不得确认任何最终发送弹窗。
- 最终发布必须人工操作。
