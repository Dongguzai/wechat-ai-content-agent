# cover-image

负责封面图生成。只有文章审核通过后才允许执行，本阶段只生成封面相关文件，不进入 HTML 排版、公众号草稿或发布阶段。

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
- 只有 `COVER_ENABLE_REAL_API=true` 且存在 `APIMART_API_KEY` 和 `APIMART_IMAGE_API_URL` 时，才允许进入真实 APIMart 分支。
- 真实 APIMart 分支必须拿到并保存 PNG/JPG 图片字节后才算成功，不能伪造成功，也不能 fallback 到 mock。
- `APIMART_COVER_STYLE` 可配置封面风格，但必须先替换具体工作室名称，再写入 `imagePrompt`、`cover-prompt.md` 或 APIMart 请求。
- 不允许 fallback 到 OpenAI、Midjourney、Replicate、Stable Diffusion 或任何其他生图服务。

## 视觉要求

- 固定尺寸：`900x383`。
- 风格：`3D animated movie style`、rounded shapes、soft cinematic lighting、expressive objects、polished commercial illustration、high-quality 3D render。
- 质感：最终画布仍为 `900x383`，prompt 中必须强调 `2K quality`、`ultra-detailed`、`high-resolution render`、`crisp details`、`clean edges`。
- 必须包含中文大标题，默认可用：

```text
AI 资讯
边界观察
```

- 中文大标题必须是视觉主元素，居中或偏左居中，粗体、清晰、现代科技感，保证手机端缩略图可读。
- 必须有明确视觉中心，例如编辑分析台、来源卡片、证据标记、决策路径或抽象流程节点。

## 禁止元素

- 真实品牌标识、官方产品标识或平台 Logo。
- 具体价格数字或价格标签。
- 零成本替换口号。
- 绝对替代表述。
- 真人肖像。
- 表情包风格。
- 廉价合成质感。
- 具体动画工作室名称。

## 审核要求

`cover-review.json` 必须检查 provider、中文大标题、尺寸、2K 质感、视觉中心、品牌与官方标识风险、价格与替代表述风险、具体工作室名称风险、imagePath 可用性，以及 `cover.review.passed` 是否为 true。
