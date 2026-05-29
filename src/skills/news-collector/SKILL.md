# news-collector

负责资讯采集步骤。

第二阶段使用 RSS 作为主干，Tavily / Exa global_search 作为补充线索。默认 dry-run 使用 mock search adapter；只有 `SEARCH_ENABLE_REAL_API=true` 且提供对应 API key 时才真实调用 Tavily / Exa。

边界：

- 只生成资讯候选池，不写文章、不生成封面、不操作公众号后台。
- RSS 候选不少于 14 条，global_search 候选最多 6 条。
- 搜索结果必须包含 provider、query、url、title、snippet、publishedAt、fetchedAt；没有 url 必须 hard rejection。
- Tavily / Exa 失败只记录 warning，不让采集 pipeline 失败。
- 采集产物写入 `outputs/raw-news.json`、`outputs/normalized-news.json`、`outputs/rejected-news.json`、`outputs/candidate-news.json`、`outputs/collection-report.md`。

实现必须放在 `src/adapters/` 下，再由 `src/pipeline/collectNews.ts` 调用。采集结果必须经过 `requireSourceUrl` 校验。
