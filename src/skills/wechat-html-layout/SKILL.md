# wechat-html-layout

将已通过文章审核和封面审核的素材转换为微信公众号编辑器可粘贴 HTML。

## 输入

- `outputs/article.md`
- `outputs/article-meta.json`
- `outputs/article-review.json`
- `outputs/cover.json`
- `outputs/cover-review.json`

## 输出

- `outputs/wechat.html`
- `outputs/wechat-layout.json`
- `outputs/wechat-layout-report.md`

## 排版风格

- Stripe-inspired，克制、清爽、科技商业感。
- 文章标题清晰，摘要只保留一句核心导语。
- 二级标题使用左边框和浅背景形成层级。
- 重点判断句使用浅灰蓝卡片，但不新增事实、不改变原意。
- 正文使用 16px 左右字号、约 1.75 行高和充足段落留白。

## 微信兼容边界

- 只使用 inline style，不使用外链 CSS、`style` 标签或外部字体。
- 不使用 JavaScript、iframe、video、复杂 grid、复杂 flex 或 fixed 定位。
- 允许使用 `section`、`p`、`span`、`strong`、`h1`、`h2`、`blockquote`、`img`、`hr`、`br`。
- 默认从 `cover.json` 读取 `imagePath` 并在顶部插入带 `alt` 的封面 `img`。

## 安全边界

- 本阶段只生成 HTML 和排版检查产物。
- 不操作公众号后台。
- 不保存公众号草稿。
- 不调用浏览器自动化。
- 不调用 APIMart。
- 不重新生成封面。
- 不修改 `article.md`。
- 不进入草稿箱写入阶段。

HTML 中不得出现高风险发送动作词、未经来源支撑的具体价格口号、免费平替口号、零成本或完全替代等绝对化表达。若源文出现受限表达，渲染层必须使用更安全的表达替换，记录 warning，并阻止下一阶段。
