# 公众号 AI 内容生产与草稿发布 Agent

第二阶段聚焦 AI 资讯采集，用 RSS 作为主干，并用 Tavily / Exa global_search 作为补充线索：

1. 从 RSS 源抓取 AI 资讯
2. 在默认 mock search 模式下补充 Tavily / Exa 搜索线索
3. 在 `SEARCH_ENABLE_REAL_API=true` 且提供 API key 时真实调用 Tavily / Exa
4. normalize、hard rejection、去重并生成 20 条候选池
5. 输出 raw、normalized、rejected、candidate 和 collection report

## 当前边界

- 不调用微信公众号后台
- 不做浏览器自动化
- 不做定时任务
- 不接数据库
- 不写文章
- 不生成封面
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
- `outputs/daily-report.md`

## 脚本

```bash
pnpm dev
pnpm dry-run
pnpm test
pnpm typecheck
```

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
- `saveWechatDraft`：当前只返回 mock 草稿记录，不触发真实后台或浏览器操作
- 禁止自动群发、自动发布、点击“群发”“发布”“确认发送”“立即发送”
- 公众号相关步骤只允许保存草稿、生成预览、等待人工确认
