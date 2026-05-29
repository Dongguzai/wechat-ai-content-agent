# topic-editor

负责第四阶段：从 `outputs/shortlisted-news.json` 的 10 条入围资讯中，选择 1 条今日公众号主选题，并生成：

- `outputs/selected-topic.json`
- `outputs/topic-selection-report.md`

## 输入

- 只读取已经入围的 `ShortlistedNewsItem[]`。
- `global_search` / Tavily / Exa 结果只能视为线索；如果缺少可靠原始来源，不允许作为主选题。

## 主编判断

不要简单按 `shortlistScore` 第一名选择。必须综合判断：

- 公众号传播价值：普通读者是否能理解，标题是否自然有吸引力。
- 技术含金量：技术读者是否觉得有讨论价值。
- 核心冲突：是否存在开源 vs 闭源、大厂 vs 创业公司、工具替代人力、工作流变化、平台规则冲突等清晰矛盾。
- 第三视角：是否能写成旁观者分析，而不是新闻复述。
- 商业或行业影响：是否影响开发者、企业、创作者、创业者或普通用户。
- 来源可靠：优先官方来源、GitHub、论文、公司博客、原始报道；拒绝缺 URL、`sourceReliability=low` 或只有搜索摘要的主选题。
- 风险可控：传闻、单一来源、营销案例和事实不稳的题目要降级或进入备选。

## decisionScore

新增 `decisionScore`，按以下权重计算：

```text
wechatTopic * 0.25
+ businessImpact * 0.20
+ technicalValue * 0.20
+ controversy * 0.15
+ sourceCredibility * 0.10
+ explainability * 0.10
```

`decisionScore` 是主编会前参考，不是唯一排序。最终输出必须解释为什么选中该题，以及为什么没有选择其他入围资讯。

## 输出内容

`selected-topic.json` 必须包含：

- `selected`：原 `ShortlistedNewsItem` 完整字段，并附加 `selection`。
- `selection.selectedReason`
- `selection.whyMostWorthWriting`
- `selection.coreConflict`
- `selection.publicInterest`
- `selection.technicalSignificance`
- `selection.businessImpact`
- `selection.predictedImpact`
- `selection.writingAngle`
- `selection.suggestedTitles`，建议 3-5 个，不能标题党。
- `selection.articleThesis`
- `selection.riskNotes`
- `selection.sourceReliability`
- `selection.decisionScore`
- `runnersUp`：至少 2 条，说明为什么接近但未选。
- `rejected`：其余未入选条目，说明淘汰理由。
- `generatedAt`

`topic-selection-report.md` 必须包含：

- 今日主选题标题
- 来源链接
- 为什么它最值得写
- 核心冲突
- 公众号写作角度
- 建议标题
- `articleThesis`
- 预计影响的人群
- 写作风险提醒
- 为什么没有选择其他入围资讯

## 阶段边界

本阶段只做主编选题决策：

- 不写公众号正文。
- 不生成 `article.md`。
- 不生成封面。
- 不排版 HTML。
- 不调用 APIMart。
- 不操作公众号后台。
- 不加入 Playwright 或浏览器自动化。
