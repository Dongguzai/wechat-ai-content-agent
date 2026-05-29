# article-reviewer

负责第六阶段文章审核 gate，只判断 `outputs/article.md` 是否可以进入“封面图生成 + HTML 排版”。

## 输入

- `outputs/article.md`
- `outputs/article-meta.json`
- `outputs/topic-fact-pack.json`
- `outputs/topic-fact-pack.md`
- `outputs/selected-topic.json`

## 输出

- `outputs/article-review.json`
- `outputs/article-review-report.md`

## 阶段边界

- 不重写 `article.md`。
- 不生成封面、`cover.json` 或图片。
- 不生成 `wechat.html`。
- 不操作公众号后台。
- 不调用 APIMart。
- 不加入 Playwright、Puppeteer 或浏览器自动化。

## 审核重点

1. 事实边界：禁止 Goose 完全替代 Claude Code、能力完全一样、Goose 零成本、Claude Code 必须 $200 才能用、Claude Code 是单独固定 $200/month 工具、免费平替等高风险表达。
2. fact pack 使用：`article-meta.usedClaims` 至少 3 条，必须来自 `topic-fact-pack`，每条保留 `safeWording`，正文要基本遵守 safeWording，关键正文事实应进入 usedClaims。
3. 文章质量：1500 字以内，有标题和小标题，第三视角，不是新闻通稿，观点清晰，至少解释“开源 / 工作流 / 成本 / 工具锁定”中的 3 个主题，并适合普通 AI 关注者、开发者、内容创作者、创业者阅读。
4. 逻辑：开头建立冲突，中段解释行业变化，有清晰论点，不从个案过度推导行业结论，结尾有趋势判断但不过度武断。
5. 标题：有传播感，不标题党，不暗示“Goose 免费平替 Claude Code”，与正文主旨一致。

## 判定规则

- 出现 high severity issue 时，`passed=false`。
- `factBoundaryCheck.passed=false` 时，`passed=false`。
- 正文超过 1500 字时，`passed=false`。
- `requiredFixes` 不为空时，`passed=false`。
- 只有 low severity issue 时，可以 `passed=true`，但要写入 `optionalSuggestions`。
- `score` 范围为 0-100。
- 只有 `score >= 80` 且没有 high issue 才能 `passed=true`。
