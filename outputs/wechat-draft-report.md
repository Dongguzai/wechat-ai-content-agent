# WeChat Draft Dry-Run Report

## 1. 草稿箱写入 dry-run 结论

已完成 mock 草稿写入。该步骤只生成本地 dry-run 结果，不接入真实微信公众号后台。

## 2. 文章标题

这条 AI 新闻背后，是一次工作流重排

## 3. HTML 路径

outputs/wechat.html

## 4. 封面图路径

/Users/Shared/AgentWork/公众号AI内容生产与草稿发布Agent/wechat-ai-content-agent/outputs/covers/cover-apimart-mock-2026-05-29T11-19-58-152Z.svg

## 5. mock draftId

mock-draft-20260529171057127

## 6. mock previewUrl

mock://wechat-draft/mock-draft-20260529171057127/preview

## 7. 已模拟的安全动作

- 检查文章审核结果: passed
- 检查封面审核结果: passed
- 检查 HTML 排版结果: passed
- 创建草稿: passed
- 填写标题: passed
- 填写正文 HTML: passed
- 上传封面图: passed
- 保存草稿: passed
- 生成预览: passed
- 等待人工确认: passed

## 8. 被禁止的动作列表

- 群发
- 发布
- 确认发送
- 立即发送

## 9. 是否需要人工确认

是，需要人工确认。

请人工登录微信公众号后台检查草稿预览，确认无误后再手动发布。

## 10. 发布边界

系统不会自动发布，也不会自动群发。
未操作真实公众号后台，未真实保存草稿，未发布，未群发。
