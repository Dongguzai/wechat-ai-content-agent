# article-writer

负责基于动态内容引擎产物写公众号正文。

## 输入

- `outputs/selected-topic.json`
- `outputs/topic-profile.json`
- `outputs/research-plan.json`
- `outputs/source-evidence.json`
- `outputs/topic-fact-pack.json`
- `outputs/editorial-plan.json`

## 输出

- `article.md`：1500 字以内中文公众号正文，第一行是标题，小标题使用二级标题。
- `article-meta.json`：标题、字数、来源选题、中心论点、使用的 claims、section claim map、风险控制、LLM 元信息、生成时间。
- `article-writing-report.md`：写作报告，说明标题、字数、使用的 fact pack claim、规避的高风险表达和阶段边界。

## MiniMax LLM

- 默认 `LLM_ENABLE_REAL_API=false`、`LLM_DRY_RUN=true`，保持 deterministic/mock 写作，不调用 MiniMax。
- 真实写作必须显式设置 `LLM_ENABLE_REAL_API=true`、`LLM_DRY_RUN=false`、`ARTICLE_WRITER_PROVIDER=minimax`，并从环境变量读取 `MINIMAX_API_KEY`。
- MiniMax 只用于正文文字生成，不生成封面、不排版 HTML、不操作微信草稿。
- `article-meta.json.llm` 必须记录 `provider`、`model`、`mode` 和 token usage。
- MiniMax 原始响应不得完整落盘；只保留正文、必要元信息和脱敏后的 usage。

## 写作边界

- 只写公众号正文，不生成封面、不生成 `cover.json`。
- 不排版 HTML，不生成或更新 `wechat.html`。
- 不操作公众号后台，不保存草稿，不发布。
- 不调用 APIMart。
- 不加入 Playwright 或浏览器自动化。

## 必须遵守的事实边界

- 文章结构必须遵守 `editorial-plan.sections` 的顺序和 `allowedClaimIds`。
- 正文 usedClaims 必须来自 `topic-fact-pack.claims`，并保留 `safeWording`、`status` 和 `evidenceIds`。
- 不写 fact pack 中的 `forbiddenWording`。
- 不把搜索摘要、媒体标题、厂商演示或编辑角度写成 verified fact。
- 不把免费、开源、试用或免费层写成零成本。
- 不把不同产品、模型、政策、案例或方案写成全面替代、能力等同或无差别迁移。

## 推荐 framing

正文应从事实边界和读者影响切入，按 EditorialPlan 展开：先说明来源和边界，再解释该题型下的关键问题、风险控制和后续观察。结尾给出克制判断，不写确定性胜负或行业定论。
