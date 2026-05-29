# Article Writing Report

## 文章标题

AI 编码代理真正卷到的，不是价格，而是工作流

## 字数

1198 字

## 使用的 fact pack claim

- “up to $200 a month”对应 Claude Max 20x 个人套餐价格，而不是 Claude Code 的单独固定价格。
  - safeWording: Anthropic 官方页面列出 Max 20x 为 $200/month；Claude Code 包含在 Pro/Max 等付费 Claude 计划中，因此应写成“最高可到 $200/月的 Claude Max 20x 订阅可使用 Claude Code”，不能写成“Claude Code 必须 $200/月”。
  - sources: <https://claude.com/pricing>, <https://support.claude.com/en/articles/11049762-choose-a-claude-plan>, <https://support.claude.com/en/articles/11145838-using-claude-code-with-your-pro-or-max-plan>
- Claude Code 可处理项目级编码任务，包括跨文件修改、测试、修 bug、Git/PR 和 MCP 工具连接。
  - safeWording: Claude Code 是 Anthropic 面向开发者的编码代理，可在项目中规划、修改代码、运行验证，并连接外部工具。
  - sources: <https://code.claude.com/docs/en/overview>
- Claude Code 的成本不只一种形态：订阅计划、API token 消耗、团队/企业计划和额外用量都可能影响实际成本。
  - safeWording: Claude Code 可以随 Pro/Max 等订阅使用，也可能在 API Key/PAYG 或企业部署下产生不同费用，实际成本取决于计划、模型和用量。
  - sources: <https://code.claude.com/docs/en/costs>, <https://support.claude.com/en/articles/11145838-using-claude-code-with-your-pro-or-max-plan>, <https://claude.com/pricing>
- Goose 是开源 AI agent，本体可免费获取和使用。
  - safeWording: Goose 可安全表述为“免费开源的本地 AI agent/开发者代理工具”。
  - sources: <https://github.com/aaif-goose/goose>, <https://goose-docs.ai/docs/getting-started/providers/>
- Goose 免费不等于零成本：使用 Anthropic、OpenAI、Google、Groq、OpenRouter 等模型时，可能需要 API Key、订阅或供应商侧费用。
  - safeWording: 更稳妥的说法是“Goose 本体免费开源，但模型调用费用取决于你接入的 LLM 提供商；部分提供商有免费层，付费模型仍可能产生费用”。
  - sources: <https://goose-docs.ai/docs/getting-started/providers/>, <https://github.com/aaif-goose/goose>
- Claude Code 和 Goose 都可归入 coding agent / developer agent 范畴，能力存在重叠。
  - safeWording: 两者都面向开发者自动化，能覆盖代码理解、文件修改、命令执行或项目级任务的一部分场景；但产品形态、模型后端、权限治理、交互体验和成熟度不同。
  - sources: <https://code.claude.com/docs/en/overview>, <https://github.com/aaif-goose/goose>, <https://block.github.io/goose/docs/guides/tips/>
- “Goose does the same thing as Claude Code”是过度绝对的说法。
  - safeWording: 可以写“Goose 在部分 coding agent 工作流上与 Claude Code 有重叠，并提供开源、可自选模型的替代路径”，不要写“能力完全一样”或“完全替代”。
  - sources: <https://venturebeat.com/infrastructure/claude-code-costs-up-to-usd200-a-month-goose-does-the-same-thing-for-free>, <https://code.claude.com/docs/en/overview>, <https://github.com/aaif-goose/goose>

## 避免的高风险表达

- 没有把 Claude Code 写成单独强制 $200/month 的工具。
- 没有把 Goose 写成无任何成本的工具。
- 没有把 Goose 和 Claude Code 写成能力等同、全量互换或胜负已定。
- 没有把媒体标题或搜索摘要当作确定性事实来源。

## 1500 字限制

- 是，当前 1198 字，未超过 1500 字。

## 阶段边界

- 是，本阶段没有进入封面、HTML 排版、公众号后台、APIMart 或浏览器自动化。
- 仅生成 article.md、article-meta.json、article-writing-report.md。
