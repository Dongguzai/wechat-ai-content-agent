# Agent 工作说明

本项目当前处于第二阶段：只允许实现 AI 资讯采集、mock dry-run、测试和安全边界补齐。任何新阶段能力都必须在用户明确要求后再开始。

## 必守边界

- 不调用微信公众号后台
- 不调用 APIMart
- 不做浏览器自动化
- 不做定时任务
- 不接数据库
- 不把输出写到 `outputs/` 之外
- 不写文章
- 不生成真实封面
- Tavily / Exa 只能通过 `src/adapters/` 接入；默认 `SEARCH_ENABLE_REAL_API=false` 时必须走 mock search

## Safety / Guardrails / 安全边界

公众号发布相关能力必须遵守以下强约束：

- 禁止自动群发公众号文章
- 禁止自动发布公众号文章
- 禁止点击“群发”
- 禁止点击“发布”
- 禁止点击“确认发送”
- 禁止点击“立即发送”
- 公众号相关步骤只允许保存草稿、生成预览、等待人工确认
- 如果后续浏览器自动化中出现上述高风险按钮，必须立即停止并报错

实现层面要求：

- `saveWechatDraft` 必须保持 mock 保存草稿，不得调用公众号后台
- 不得加入 Playwright、Puppeteer 或其他浏览器自动化依赖
- 不得加入真实发布、群发、确认发送逻辑
- 执行任何公众号相关 mock 步骤前，必须保留 `forbidAutoPublish` 风险词检查

## 代码约定

- 使用 TypeScript、pnpm、ESM
- pipeline 步骤保持独立模块，方便后续替换为真实实现
- 核心数据结构必须放在 `src/types/`
- 外部服务必须通过 `src/adapters/` 封装
- 新增能力时先补类型，再接 pipeline

## 第二阶段验收

运行：

```bash
pnpm dry-run
```

第二阶段 dry-run 只执行资讯采集，并在 `outputs/` 中得到：

- `raw-news.json`
- `normalized-news.json`
- `rejected-news.json`
- `candidate-news.json`
- `collection-report.md`
