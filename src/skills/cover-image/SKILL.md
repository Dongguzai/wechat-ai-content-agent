# cover-image

负责第七阶段封面图生成。只有文章审核通过后才允许执行，本阶段只生成封面相关文件，不进入 HTML 排版、公众号草稿或发布阶段。

## 输入

- `outputs/article.md`
- `outputs/article-meta.json`
- `outputs/article-review.json`
- `outputs/selected-topic.json`
- `outputs/topic-fact-pack.json`

## 输出

- `outputs/cover.json`
- `outputs/cover-prompt.md`
- `outputs/cover-review.json`
- `outputs/covers/` 下的封面 mock 文件或真实图片文件

## Provider 边界

- 只允许 `apimart`。
- 默认 mock，不调用真实外部 API。
- 只有 `COVER_ENABLE_REAL_API=true` 且存在 `APIMART_API_KEY` 时，才允许进入真实 APIMart 分支。
- 真实 APIMart API 细节未确认前，真实分支必须抛出明确 TODO 错误，不能伪造成功。
- 不允许 fallback 到 OpenAI、Midjourney、Replicate、Stable Diffusion 或任何其他生图服务。

## 视觉要求

- 固定尺寸：`900x383`。
- 风格：`3D animated movie style`、rounded shapes、soft cinematic lighting、expressive objects、polished commercial illustration、high-quality 3D render。
- 质感：最终画布仍为 `900x383`，prompt 中必须强调 `2K quality`、`ultra-detailed`、`high-resolution render`、`crisp details`、`clean edges`。
- 必须包含中文大标题，推荐：

```text
AI 编码代理
卷向工作流
```

- 中文大标题必须是视觉主元素，居中或偏左居中，粗体、清晰、现代科技感，保证手机端缩略图可读。
- 必须有明确视觉中心，例如 3D 代码工作台、发光工作流中枢节点、围绕中心节点连接的抽象代码窗口，或从工具流向工作流入口的视觉路径。

## 禁止元素

- 真实品牌标识或官方产品标识
- Claude / Goose 官方标识
- 具体价格数字或价格标签
- 零成本替换口号
- 绝对替代表述
- 真人肖像
- 表情包风格
- 廉价合成质感
- 具体动画工作室名称

## 审核要求

`cover-review.json` 必须检查 provider、中文大标题、尺寸、2K 质感、视觉中心、品牌与官方标识风险、价格与替代表述风险、具体工作室名称风险、imagePath 可用性，以及 `cover.review.passed` 是否为 true。
