# Title Generator Skill

## 目标

为已经通过 fact pack 约束的公众号文章生成 5 个安全标题，并选择 1 个最终标题写回 `article-meta.json` 和正文首行。

## 输入

- `outputs/article.md`
- `outputs/article-meta.json`
- `outputs/selected-topic.json`
- `outputs/topic-fact-pack.json`
- `config/editorial-style.md`
- 可选：`feedback/*.json`

## 标题类型

必须各生成 1 个：

1. 判断型标题。
2. 反差型标题。
3. 趋势型标题。
4. 普通人影响型标题。
5. 技术圈讨论型标题。

## 评分维度

每个标题都必须输出：

- `spreadScore`
- `accuracyScore`
- `nonClickbaitScore`
- `wechatFitScore`
- `thesisMatchScore`
- `finalScore`

## 安全边界

- 禁止标题党。
- 禁止违反 fact pack 的安全表达边界。
- 禁止出现 title generator 定义的 forbidden terms。
- 不写“免费平替”“完全替代”“能力相同”“零成本”等未经核验或过度绝对表达。
- 不新增任何发布、群发、公众号后台或真实微信 API 能力。

## MiniMax LLM

- 默认 `LLM_ENABLE_REAL_API=false`、`LLM_DRY_RUN=true`，继续使用 deterministic/mock 标题候选，不调用 MiniMax。
- 真实标题生成必须显式设置 `LLM_ENABLE_REAL_API=true`、`LLM_DRY_RUN=false`、`TITLE_GENERATOR_PROVIDER=minimax`，并从环境变量读取 `MINIMAX_API_KEY`。
- MiniMax 只负责提出 5 个候选标题；本地评分、forbidden terms 检查和最终选择仍必须执行。
- `title-candidates.json` 记录 `candidates`、`selectedTitle`、`forbiddenTerms` 和 `llm` 元信息。
- MiniMax 原始响应不得完整落盘；只保留候选标题、评分、必要元信息和脱敏后的 usage。

## 输出

- `outputs/title-candidates.json`
- `outputs/title-selection-report.md`
- 最终标题同步到 `outputs/article-meta.json`
- 最终标题同步到 `outputs/article.md`，供 `wechat.html` 渲染使用
