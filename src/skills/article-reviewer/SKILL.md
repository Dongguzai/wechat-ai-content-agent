# article-reviewer

负责文章审核 gate，只判断 `outputs/article.md` 是否可以进入“封面图生成 + HTML 排版”。

## 输入

- `outputs/article.md`
- `outputs/article-meta.json`
- `outputs/topic-profile.json`
- `outputs/topic-fact-pack.json`
- `outputs/editorial-plan.json`
- `outputs/selected-topic.json`

## 输出

- `outputs/article-review.json`
- `outputs/article-review-report.md`

## MiniMax LLM

- 默认 `LLM_ENABLE_REAL_API=false`、`LLM_DRY_RUN=true`，只执行本地规则审核，不调用 MiniMax。
- 真实辅助审稿必须显式设置 `LLM_ENABLE_REAL_API=true`、`LLM_DRY_RUN=false`、`ARTICLE_REVIEWER_PROVIDER=minimax`，并从环境变量读取 `MINIMAX_API_KEY`。
- MiniMax 只能作为辅助审稿；本地硬规则、ReviewPolicy、fact pack forbiddenWording 和 1500 字限制仍是最终 gate。
- 即使 MiniMax 判断通过，只要本地 blocking issue 存在，`passed` 仍必须为 `false`。
- `article-review.json.llm.mode` 在真实辅助审稿下记录为 `rules+real`。

## 阶段边界

- 不重写 `article.md`。
- 不生成封面、`cover.json` 或图片。
- 不生成 `wechat.html`。
- 不操作公众号后台。
- 不调用 APIMart。
- 不加入 Playwright、Puppeteer 或浏览器自动化。

## 审核重点

1. 事实边界：禁止命中 fact pack 的 `forbiddenWording`，包括零成本、全面替代、能力等同、单项指标推出整体胜负等过度表达。
2. ReviewPolicy：按 TopicProfile 加载定价、benchmark、融资、并购、政策、研究、安全事故、案例或通用审核规则。
3. fact pack 使用：`article-meta.usedClaims` 至少 3 条，必须来自 `topic-fact-pack`，关键正文事实应进入 usedClaims。
4. 文章质量：1500 字以内，有标题和小标题，第三视角，不是新闻通稿，观点清晰，并优先覆盖 `articleMeta.editorialPlan.requiredThemes`。
5. 逻辑：开头建立冲突，中段解释影响或风险，有清晰论点，不从个案过度推导行业结论，结尾有趋势判断但不过度武断。
6. 标题：有传播感，不标题党，不命中 fact pack 禁止表述，与正文主旨一致。

## 判定规则

- 出现 blocking issue 时，`passed=false`。
- `factBoundaryCheck.passed=false` 时，`passed=false`。
- 正文超过 1500 字时，`passed=false`。
- `requiredFixes` 不为空时，`passed=false`。
- 只有 low severity issue 时，可以 `passed=true`，但要写入 `optionalSuggestions`。
- `score` 范围为 0-100。
