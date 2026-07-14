# topic-fact-checker

负责围绕 `outputs/selected-topic.json` 生成动态事实核验包，为后续公众号文章提供可靠事实边界。

## 输入

- `outputs/selected-topic.json`
- `outputs/topic-profile.json`
- `outputs/research-plan.json`
- `outputs/source-evidence.json`
- `outputs/topic-selection-report.md`

## 输出

- `outputs/topic-fact-pack.json`
- `outputs/topic-fact-pack.md`

## 核验重点

- 按 TopicProfile 和 ResearchPlan 区分题型，例如产品发布、模型评测、定价、融资、并购、政策、研究发布、安全事故和案例。
- 每条 claim 必须记录 `status`、`sourceUrls`、`evidenceIds`、`safeWording`、`requiredQualifiers`、`forbiddenWording` 和风险维度。
- 搜索摘要、RSS 摘要和人工角度只能作为线索，不能直接升级成 verified claim。
- 价格、benchmark、融资金额、监管义务、安全影响范围等硬事实必须保留来源和适用范围。
- 不同产品、模型、政策或案例只能做有限条件下的比较，不写全面替代、能力等同、零成本或行业定论。

## 必须避免

- 只根据 Tavily / Exa snippet 下判断。
- 把媒体标题、搜索摘要、厂商演示或单一案例写成确定性事实。
- 把免费层、开源、试用或社区版本写成零成本。
- 把单项 benchmark、单笔融资、单一政策或单个案例外推成全行业结论。

## 阶段边界

本阶段只做事实核验包：

- 不写公众号正文。
- 不生成 `article.md`。
- 不生成封面。
- 不排版 HTML。
- 不调用 APIMart。
- 不操作公众号后台。
- 不加入 Playwright 或浏览器自动化。
