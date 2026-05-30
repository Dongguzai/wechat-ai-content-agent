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

## 输出

- `outputs/title-candidates.json`
- `outputs/title-selection-report.md`
- 最终标题同步到 `outputs/article-meta.json`
- 最终标题同步到 `outputs/article.md`，供 `wechat.html` 渲染使用
