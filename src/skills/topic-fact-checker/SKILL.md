# topic-fact-checker

负责第 4.5 阶段：围绕 `outputs/selected-topic.json` 中的主选题生成事实核验包，为下一阶段写公众号文章提供可靠事实边界。

## 输入

- `outputs/selected-topic.json`
- `outputs/topic-selection-report.md`

## 输出

- `outputs/topic-fact-pack.json`
- `outputs/topic-fact-pack.md`

## 核验重点

### Claude Code 价格

- 核验 “up to $200 a month” 是否准确。
- 区分 Claude Code 本身、Claude Max / Claude subscription / Anthropic 相关套餐。
- 标明不同套餐，例如 Pro、Max 5x、Max 20x、Team、Enterprise 或 API/PAYG 的差异。
- 非官方报道只能作为选题线索，不能作为最终事实。

### Goose 免费属性

- 核验 Goose 是否开源。
- 核验 Goose 本体是否免费使用。
- 标明 Goose 通常需要配置 LLM provider、API Key、订阅或本地模型。
- 如果调用 Claude、OpenAI、Google、OpenRouter、Groq 等模型，仍可能产生模型费用。
- “free” 必须安全表述为“工具本体免费开源，不等于底层模型零成本”。

### 功能相似度

- 核验 Goose 和 Claude Code 是否都可归入 coding agent / developer agent / AI coding assistant。
- 核验二者是否都涉及代码理解、文件修改、命令执行、项目级任务处理。
- 将 “does the same thing” 降级为“部分 coding agent 工作流有重叠”。
- 不允许把标题化表达写成能力完全一致。

## 必须避免

- “Goose 完全替代 Claude Code”
- “Goose 和 Claude Code 能力完全一样”
- “Goose 完全免费且没有任何成本”
- “Claude Code 必须花 $200 才能用”
- 只根据 Tavily/Exa snippet 下判断

## recommendedFraming

优先使用稳妥 framing：

> 这不是简单的免费替代高价工具，而是 coding agent 正在从付费产品变成开源基础设施的一次信号。

## 阶段边界

本阶段只做事实核验包：

- 不写公众号正文。
- 不生成 `article.md`。
- 不生成封面。
- 不排版 HTML。
- 不调用 APIMart。
- 不操作公众号后台。
- 不加入 Playwright 或浏览器自动化。
