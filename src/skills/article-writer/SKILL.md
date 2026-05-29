# article-writer

负责基于 `outputs/selected-topic.json`、`outputs/topic-selection-report.md`、`outputs/topic-fact-pack.json`、`outputs/topic-fact-pack.md` 写公众号正文。

## 输入

- `selected-topic.json`：主选题、建议标题、文章中心论点和风险提醒。
- `topic-selection-report.md`：主编选题报告，用于确认选题边界。
- `topic-fact-pack.json`：事实包，正文必须使用其中的 `safeWording`。
- `topic-fact-pack.md`：事实包人读报告，用于复核禁止写法。

## 输出

- `article.md`：1500 字以内中文公众号正文，第一行是标题，小标题使用二级标题。
- `article-meta.json`：标题、字数、来源选题、中心论点、使用的 claims、风险控制、生成时间。
- `article-writing-report.md`：写作报告，说明标题、字数、使用的 fact pack claim、规避的高风险表达和阶段边界。

## 写作边界

- 只写公众号正文，不生成封面、不生成 `cover.json`。
- 不排版 HTML，不生成或更新 `wechat.html`。
- 不操作公众号后台，不保存草稿，不发布。
- 不调用 APIMart。
- 不加入 Playwright 或浏览器自动化。

## 必须遵守的事实边界

- 不写 Claude Code 是单独固定 $200/month 工具。
- 若提到价格，必须写清楚 `$200/month` 更安全地对应 Claude Max 20x 个人套餐价格，不是 Claude Code 单独固定价格。
- 不写 Goose 没有任何成本。必须写清楚 Goose 本体免费开源，但接入 Claude、OpenAI、Google 等模型时仍可能产生 API Key、订阅或按量费用。
- 不写 Goose 能完全替代 Claude Code。
- 不写 Goose 和 Claude Code 能力完全一样。
- 不只根据搜索摘要写确定性事实。
- 比较二者时，只能写成两者在部分 coding agent 工作流上有重叠。

## 推荐 framing

这不是简单的“免费开源工具对高价订阅工具”的价格对比，而是 coding agent 正在从单一付费产品扩散成开源基础设施的一次信号。

正文应从“高价订阅 vs 免费开源”的冲突切入，马上补充事实边界；中段解释闭源订阅工具和开源基础设施对开发者工作流入口的争夺；结尾给出趋势判断：coding agent 的竞争重点正在从模型能力转向开发者工作流入口。
