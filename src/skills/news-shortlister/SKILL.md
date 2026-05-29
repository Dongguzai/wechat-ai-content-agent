# news-shortlister

负责第三阶段“编辑部初筛”：从 `outputs/candidate-news.json` 的 20 条 candidate-news 中筛选 10 条 `shortlisted-news`，供后续公众号选题会讨论。

边界：

- 只生成 `outputs/shortlisted-news.json` 和 `outputs/shortlist-report.md`。
- 不选择最终主选题，不生成 `selected-topic`。
- 不写公众号文章，不生成封面，不操作公众号后台。
- 不调用 APIMart，不启动 Playwright 或浏览器自动化。

筛选原则：

- 不按 `scores.final` 直接排序；必须综合技术含金量、公众号传播价值、商业影响、争议度、来源可信度、可解释性和原创接近度。
- 优先选择有原始来源、事实清晰、能展开观点的资讯。
- 淘汰重复事件、浅层产品小更新、SEO 味重、转载/聚合感强、没有讨论空间的资讯。
- `global_search` 可以入围但最多 3 条；RSS 入围不少于 7 条。
- Tavily + Exa 合计入围最多 3 条。
- Tavily/Exa 的搜索摘要只能作为线索，不能直接成为事实依据；后续必须回到可访问的原始 URL 核验。

每条 `ShortlistedNewsItem` 必须包含：

- 原 `NormalizedNewsItem` 字段。
- `shortlistScore`。
- `shortlistMetrics`。
- `tags`，用于表达复合属性，可包含 `tooling`、`open-source`、`agent`、`developer-workflow`、`model`、`product`、`research`、`business`、`community`、`policy`。
- `editorial.shortlistReason`。
- `editorial.audienceFit`。
- `editorial.topicAngle`，必须针对该资讯定制，说明表面事件、背后矛盾和对读者/开发者/创业者/内容创作者的影响，避免套用 category 模板。
- `editorial.recommendedUse`。
- 必要时包含 `editorial.riskNote`。

报告必须包含 candidate 数、shortlisted 数、RSS/global_search/Tavily/Exa 入围数量、各 category 数量、各 tags 数量、每条入围理由，以及所有被淘汰资讯的淘汰原因。
