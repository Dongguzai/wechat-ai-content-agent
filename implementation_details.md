# Dynamic Content Engine Details

## Old To New Data Mapping

| Old | Current Use | Target |
| --- | --- | --- |
| `SelectedTopic.selected.selection` | 选题理由、角度、thesis、suggestedTitles | TopicProfile 的输入之一；保留人工确认兼容。 |
| `TopicFactPack.verifiedClaims` | 文章 usedClaims、审核 fact boundary、封面上下文 | `DynamicFactPack.claims`，每条 claim 有 id、status、evidenceIds、safeWording、forbiddenWording。 |
| `TopicFactPack.comparison.claudeCode/goose` | 旧专题结构和 generic fallback 判定 | 删除生产依赖；普通对比题由 TopicProfile + Policy + claims 表达。 |
| `ArticleMeta.usedClaims` | 审核正文事实来源 | 增加 claim id / sectionClaimMap，追踪到 DynamicFactPack 和 SourceEvidence。 |
| `TitleCandidate` | 五类标题 + 静态 forbidden terms | 保留五类标题，评分输入改为 TopicProfile / DynamicFactPack / EditorialPlan / 正文。 |
| `ArticleReviewIssue` | type/severity/message/evidence/suggestion | 增加 ruleId、policyId、source、blocking 追踪。 |

## File Change Scope

### Already Touched In Milestone 1

- `tests/fixtures/topicFixtures.ts`: 12 类选题 fixture 和预期画像字段。
- `tests/topic-fixtures.test.ts`: fixture 完整性、多样性和旧专题污染隔离测试。
- `implementation.md`: 目标、架构、里程碑和进度。
- `implementation_details.md`: 数据映射、设计细节和测试矩阵。

### Added In Milestone 2

- `src/types/topicProfile.ts`: TopicProfile 类型、枚举和输出结果类型。
- `src/pipeline/classifyTopic.ts`: deterministic mock 分类器、MiniMax JSON 分类路径、repair fallback 和 Markdown 报告。
- `src/adapters/llm.ts`: 新增 `topic-classifier` stage 与 `TOPIC_CLASSIFIER_*` 环境变量。
- `src/types/pipeline.ts`: 增加 topic profile 输出文件和 artifact。
- `src/pipeline/runDailyPipeline.ts`: 在 `--from article` 的旧 FactPack 之前生成 TopicProfile；`--from layout` 可读取已有 profile，缺失时仍兼容。
- `tests/topic-profile.test.ts`: 12 类 TopicProfile、真实 MiniMax JSON、repair fallback 和输出文件测试。
- `tests/llm-config.test.ts`: topic-classifier stage-specific 配置测试。

### Added In Milestone 3

- `src/config/policyRegistry.ts`: 配置驱动的 PolicyRegistry，负责加载、校验、匹配和 fallback。
- `config/research-policies/policies.json`: Research policy 配置。
- `config/editorial-patterns/policies.json`: Editorial pattern 配置。
- `config/review-policies/policies.json`: Review policy 配置。
- `tests/policy-registry.test.ts`: policy 加载、组合命中、fallback、解析错误和误匹配防护测试。

### Added In Milestone 4

- `src/types/researchPlan.ts`: ResearchPlan、ResearchTask 和输出类型。
- `src/types/sourceEvidence.ts`: SourceEvidence、SourceEvidenceItem 和来源状态类型。
- `src/pipeline/buildResearchPlan.ts`: 根据 TopicProfile + research policy 生成动态调研任务。
- `src/pipeline/collectSourceEvidence.ts`: metadata-only 来源证据收集，不抓取网页、不伪造正文。
- `src/types/pipeline.ts`: 增加 research plan 和 source evidence 输出文件与 artifacts。
- `src/pipeline/runDailyPipeline.ts`: 在旧 FactPack 前接入 buildResearchPlan 与 collectSourceEvidence。
- `tests/research-plan.test.ts`: 题型差异化 ResearchPlan、policy traceability、search lead 限制和 metadata-only 证据测试。

### Changed In Milestone 5

- `src/types/factPack.ts`: `TopicFactPack` 升级为 `schemaVersion: "2.0"`；新增 `DynamicFactClaim`、`claims`、`unsupportedClaims`、`conflictingClaims`、`entities`、`sourceReliabilityReason`、`sourceEvidenceIds`；移除生产类型中的 `TopicFactPackComparison`。
- `src/pipeline/buildTopicFactPack.ts`: 删除 `isClaudeGooseTopic`、固定 Claude/Goose source URLs 和 comparison report；改为读取 TopicProfile、ResearchPlan、SourceEvidence，并在缺失时使用保守 fallback。
- `src/pipeline/writeArticle.ts`: generic 判定改为 schema version；usedClaims 从兼容 `verifiedClaims` 投影读取；forbidden wording 从 `claims[].forbiddenWording` 汇总；选题文本进入 mock 文章前会做安全清洗。
- `src/pipeline/generateTitles.ts`: forbidden terms 从动态 claim forbiddenWording 汇总，不再读取 `comparison.unsafeComparisonClaims`。
- `src/pipeline/reviewArticle.ts`: generic 判定改为 schema version；旧价格边界正则收窄为真实价格表达，避免 URL slug 中的 `usd200` 误触发。
- `tests/topic-fact-pack.test.ts`: 契约改为 DynamicFactPack schema、claim 状态、兼容投影和无 comparison 字段。
- `tests/cover-image.test.ts`、`tests/real-data-audit.test.ts`、`tests/wechat-api-draft.test.ts`、`tests/daily-auto.test.ts`: 测试夹具升级为 v2 fact pack。

### Added In Milestone 6

- `src/types/editorialPlan.ts`: EditorialPlan、EditorialPlanSection 和输出类型；section 显式包含 `allowedClaimIds`、`requiredEvidenceIds`、`keyQuestions`、`riskControls`。
- `src/pipeline/buildEditorialPlan.ts`: 根据 TopicProfile、ResearchPlan、DynamicFactPack 和 editorial policies 生成动态文章结构；覆盖定价、benchmark、融资、政策、论文、安全事故、案例和通用产品更新结构。
- `src/types/pipeline.ts`: 增加 editorial plan 输出文件和 artifacts。
- `src/pipeline/runDailyPipeline.ts`: 在 DynamicFactPack 后接入 buildEditorialPlan；`--from article` 文章阶段由 10 步变为 11 步。
- `src/types/article.ts`: ArticleSection 增加 `planSectionId` / `claimIds`，ArticleUsedClaim 增加 `id` / `evidenceIds` / `status`，ArticleMeta 增加 `editorialPlan.sectionClaimMap` 和 `requiredThemes`。
- `src/pipeline/writeArticle.ts`: mock 和 real LLM 写作均读取 EditorialPlan；mock 文章按 section plan 生成，real prompt 要求遵守 section 顺序和 allowedClaimIds。
- `src/pipeline/reviewArticle.ts`: 主题覆盖从固定“开源 / 工作流 / 成本 / 工具锁定”迁移为优先读取 `articleMeta.editorialPlan.requiredThemes`；usedClaim 匹配优先使用 dynamic claim id。
- `tests/editorial-plan.test.ts`: 验证不同事件类型生成不同结构、policy trace、allowedClaimIds 和输出报告。
- `tests/article-writer.test.ts`: 验证 article-meta 写入 section claim map，并按动态 requiredThemes 校验文章。

### Changed In Milestone 7

- `src/types/title.ts`: TitleCandidate 增加 `sourceClaimIds` 和 `matchedThemes`，用于追踪标题支撑来源。
- `src/pipeline/generateTitles.ts`: 删除 Claude/Goose 专题分支式候选模板；候选标题根据 `articleMeta.editorialPlan.requiredThemes`、正文、选题、受众和 DynamicFactPack claims 生成。
- `src/pipeline/generateTitles.ts`: `scoreCandidate` 增加动态主题命中、claim id 支撑、未支撑数字/强事实拦截。
- `src/pipeline/generateTitles.ts`: real LLM 候选也统一经过本地动态评分、claim 支撑和 forbiddenWording 检查。
- `tests/title-generator.test.ts`: 验证候选标题写入 `sourceClaimIds` / `matchedThemes`，并验证人工标题中的未支撑数字会产生 violation 且不会被选中。

### Changed In Milestone 8

- `src/types/article.ts`: ArticleReviewIssue 增加 `ruleId`、`policyId`、`source`、`blocking`，ArticleReviewResult 增加可选 `reviewPolicies` trace。
- `src/pipeline/reviewArticle.ts`: ReviewArticleInput / Options 增加 `topicProfile` 和 `reviewPolicies`；`reviewArticleWithReport` 会读取 `topic-profile.json` 并通过 PolicyRegistry 加载 review policies。
- `src/pipeline/reviewArticle.ts`: fact boundary 从全局 Claude/Goose 专题正则迁移为 DynamicFactPack `forbiddenWording` 派生，并支持“不写 / 不等于 / 不得把...写成”等否定或风险控制语境。
- `src/pipeline/reviewArticle.ts`: 新增 ReviewPolicy 执行器，覆盖无来源数字、pricing、benchmark、regulation、security incident、funding、acquisition、product launch、research release、case study 等题型风险。
- `src/pipeline/reviewArticle.ts`: `claimIsReflectedSafely` 和 `findUntrackedBodyFacts` 改为 fact pack claim / claim id 驱动，不再写死 Claude Code / Goose 语义。
- `src/pipeline/reviewArticle.ts`: LLM 辅助审稿 issue 标记为 `auxiliary_llm`；本地 fact_pack / review_policy / local_rule blocking issue 仍决定最终 passed，不能被 LLM 通过结论覆盖。
- `src/pipeline/runDailyPipeline.ts`: article 阶段和 layout 阶段复审显式传递已有 TopicProfile，确保审核策略和选题画像一致。
- `tests/article-reviewer.test.ts`: 验证 issue 追踪字段、pricing ReviewPolicy 阻断、fact pack forbiddenWording 阻断和 real LLM 不可覆盖本地硬规则。

### Changed In Milestone 9

- `apps/dashboard/lib/dashboard-data.ts`: DashboardStatus 增加 `dynamicArtifacts`；status steps 增加 TopicProfile、ResearchPlan、SourceEvidence、EditorialPlan 和 ReviewPolicy 状态。
- `apps/dashboard/lib/dashboard-data.ts`: ArticleData 增加 `topicProfile`、`researchPlan`、`sourceEvidence`、`editorialPlan`，供文章工作台展示动态内容引擎上下文。
- `apps/dashboard/components/article-workbench.tsx`: 右侧轻量状态展示选题画像、调研任务数、来源证据数、编辑段落数和审核策略摘要；详情 JSON 一并包含动态产物。
- `src/pipeline/runDailyPipeline.ts`: `--from layout` 阶段增加动态产物完整性校验，要求 topic-profile、research-plan、source-evidence、editorial-plan 全部存在且 `topicId` 与 selected topic 一致。
- `src/pipeline/runDailyPipeline.ts`: `--from layout` 阶段校验 `topic-fact-pack.topicId` 和 `article-meta.editorialPlan.id`，防止跨选题复用旧 outputs。
- `tests/dashboard-api.test.ts`: 验证 Dashboard status / ArticleData 能读取并展示动态产物状态。
- `tests/editorial-brief-flow.test.ts`: 验证 `--from layout` 缺少动态产物时阻断并提示重新从 article 阶段生成。

### Coupled Production Files Identified

- `src/pipeline/buildTopicFactPack.ts`
  - DONE in Milestone 5: `isClaudeGooseTopic` 和固定 Claude / Goose comparison 已移除。
  - Final audit: DynamicFactPack 由 TopicProfile / ResearchPlan / SourceEvidence 驱动；metadata-only 模式保持保守，不伪造 verified claim。
- `src/types/factPack.ts`
  - DONE in Milestone 5: `TopicFactPackComparison` 已从生产类型移除。
  - Final audit: `verifiedClaims` 仅作为兼容投影存在，不包含 Claude/Goose 专属结构，不强迫下游回到旧 comparison。
- `src/pipeline/writeArticle.ts`
  - DONE in Milestone 6: mock sections 和 real prompt 已接入 EditorialPlan allowedClaimIds。
  - DONE in final audit: fallback sections、subtitle、risk controls 和 sanitizer 已改为事实边界 / 读者影响 / 风险控制；`validateArticle` 已接入 DynamicFactPack `forbiddenWording`。
- `src/pipeline/generateTitles.ts`
  - DONE in Milestone 7: `createRawCandidates` 和 scoring 已改为动态主题 / claim / EditorialPlan 驱动。
  - DONE in final audit: `$200` / Claude / Goose 专属标题禁止规则已移除；保留的是通用绝对化和发布风险 guard。
- `src/pipeline/reviewArticle.ts`
  - DONE in Milestone 6: `requiredThemes` 和 usedClaim 匹配已支持 EditorialPlan / dynamic claim id。
  - DONE in Milestone 8: `factBoundaryRules` 已移除，`claimIsReflectedSafely`、`findUntrackedBodyFacts` 已迁移到 fact pack claim / forbiddenWording / claim id 驱动。
- `src/pipeline/selectTopic.ts`
  - DONE in final audit: `profileFor` 已改为 category / tags / source-title 驱动的通用 profile；`whyNotSelectedFor` 已改为动态 profile + category 解释。
- `src/pipeline/shortlistNews.ts`
  - DONE in final audit: `canonicalTagsFor` 和 `topicAngleFor` 已移除 Claude/Goose、固定 coding-agent 工具名和旧成本题分支，改为 category / tag / risk 泛化。
- `src/pipeline/renderWechatHtml.ts`、`src/pipeline/generateCover.ts`
  - DONE in final audit: 旧专题 rewrite 已改成价格 / 能力等同 / 零成本 / 绝对替代等通用安全替换；封面默认标题和视觉中心已改为 AI 资讯边界观察。
- `src/skills/*`
  - DONE in final audit: topic-fact-checker、article-writer、article-reviewer、cover-image、wechat-html-layout 已同步为动态内容引擎和通用安全边界。

### Dashboard Dependencies

- `apps/dashboard/lib/dashboard-data.ts`
  - 读取 `outputs/article-meta.json`、`article-review.json`、`title-candidates.json`、`wechat-layout.json` 等，未读取 TopicProfile。
  - 新增动态产物时应以 optional read + waiting state 接入。
- `apps/dashboard/lib/editor-workflow.ts`
  - 文章编辑、标题选择、封面重生成、裁剪等依赖现有 outputs 文件。
  - 封面 prompt 安全替换已改为通用品牌标识、价格口号、零成本和绝对替代表述 guard。
- `apps/dashboard/lib/actions.ts`
  - action 白名单固定，`continueArticle` 调 `pnpm run:daily -- --from article`；禁止 publish/freepublish/mass/sendall。

## Policy Design

- Policy registry 不使用巨型 `switch` / 长 `if/else`；使用配置目录加载和按 matcher 组合。
- 每个 policy 必须有 `id`、`version`、`scope`、`match` 和 `rules`。
- Match 维度：
  - `primaryDomain`
  - `eventTypes`
  - `riskDimensions`
- 无匹配时进入 `generic-safe`。
- 后续 review issue 必须记录 `policyId` 和 `ruleId`。
- Milestone 3 当前实现：
  - 每个 scope 独立 fallback 到该 scope 的 `generic-safe`。
  - 一个 policy 声明了多个维度时，所有声明维度都必须至少命中一个值；这避免 `regulation` 因共同拥有“生效时间”而误加载 `pricing`。
  - 返回的 policy 带 `sourcePath` 和 `matchReasons`，后续 ReviewPolicy 可直接追踪规则来源。
  - 配置解析失败、目录缺失、重复 policy、scope 不匹配、枚举非法都会明确报错。

## LLM Stage Design

已有阶段：

- `article-writer`
- `title-generator`
- `article-reviewer`
- `news-localizer`

Milestone 2 新增：

- `topic-classifier`

要求：

- mock/dry-run 使用 deterministic 分类。
- real 模式使用 MiniMax JSON，复用 `requestLlmJsonWithRepair`。
- 分类失败落入 `other` + 低置信度，不伪造高置信。
- `topic-classifier` 需要 stage-specific env：
  - `TOPIC_CLASSIFIER_PROVIDER`
  - `TOPIC_CLASSIFIER_MODEL`
  - `TOPIC_CLASSIFIER_MAX_COMPLETION_TOKENS`

## Compatibility Strategy

- Milestone 2 接入 `classifyTopic` 后，旧 FactPack 继续运行；TopicProfile 缺失时 Dashboard 不崩溃。
- Milestone 3/4 先新增 policy、research 和 evidence 产物，不立刻删除旧文章链路。
- Milestone 5 才升级 FactPack 类型，并提供兼容读取或迁移层，避免一次性破坏所有下游。
- `--until brief` 行为不变。
- `--from article` 在新阶段全部接入后才变为完整动态流程。
- `--from layout` 后续只读取已有动态产物，缺失时报错，不静默跨选题复用旧 outputs。

## Test Matrix

## Real Topic Regression Repair Scope (2026-07-13)

- Prior local baseline before this repair: `pnpm test` 275 pass, `pnpm typecheck` pass, `pnpm dashboard:build` pass, `git diff --check` pass.
- Regression artifacts already produced under `reports/real-topic-regression-*`, `tmp/regression/`, and `outputs/regression-runs/`; they are treated as evidence, not source for production branching.
- Production repair files are limited to generalized SourceEvidence, DynamicFactPack, article writer validation/repair, review diagnostics, and tests/docs that cover those behaviors.
- Prohibited changes remain in force: no real WeChat write, no publish/freepublish/mass/sendall path, no APIMart success spoofing, no search-summary-as-evidence, no forced review pass, and no fixture-specific hardcoding.

### Repair Design Notes

- SourceEvidence moves from metadata-only to safe HTTP extraction for `http`/`https` pages only. It must block localhost, loopback/private IPs, non-web schemes, unsupported content types, overlarge bodies, timeouts, and unsafe redirects.
- Extracted evidence is represented as task-linked snippets. A source can support verified claims only when snippets are available and the source is not a search lead.
- DynamicFactPack may mark a claim `verified` only when every supporting source is usable and claim numbers are present in supporting snippets. Metadata and search leads remain unverified or partial.
- The article writer receives structured claim constraints and has a finite repair chain for forbidden wording, missing qualifiers, minor over-length, and mild structure drift. It must not repair evidence insufficiency or unsupported fact creation into a pass.
- v2 regression output target: `outputs/regression-runs-v2/` plus `reports/real-topic-regression-v2-report.md/json`, including before/after comparison and fault-injection results.

### Baseline

- `pnpm test`
- `pnpm typecheck`
- `pnpm dashboard:build`
- `git diff --check`

### Milestone 1

- `node --import tsx --test tests/topic-fixtures.test.ts`
- `pnpm test`
- `pnpm typecheck`
- `git diff --check`

2026-07-13 结果：

- `node --import tsx --test tests/topic-fixtures.test.ts`: 3 pass / 0 fail。
- `pnpm test`: 254 pass / 0 fail。
- `pnpm typecheck`: pass。
- `git diff --check`: pass。

### Milestone 2

- `node --import tsx --test tests/topic-fixtures.test.ts tests/topic-profile.test.ts tests/llm-config.test.ts`
- `pnpm test`
- `pnpm typecheck`
- `git diff --check`

2026-07-13 结果：

- `node --import tsx --test tests/topic-fixtures.test.ts tests/topic-profile.test.ts tests/llm-config.test.ts`: 15 pass / 0 fail。
- `pnpm test`: 260 pass / 0 fail。
- `pnpm typecheck`: pass。
- `pnpm dashboard:build`: pass。
- `git diff --check`: pass。

### Milestone 3

- `node --import tsx --test tests/policy-registry.test.ts`
- `pnpm test`
- `pnpm typecheck`
- `git diff --check`

2026-07-13 结果：

- `node --import tsx --test tests/policy-registry.test.ts`: 6 pass / 0 fail。
- `pnpm test`: 266 pass / 0 fail。
- `pnpm typecheck`: pass。
- `git diff --check`: pass。

### Milestone 4

- `node --import tsx --test tests/research-plan.test.ts`
- `pnpm test`
- `pnpm typecheck`
- `git diff --check`

2026-07-13 结果：

- `node --import tsx --test tests/research-plan.test.ts`: 4 pass / 0 fail。
- `pnpm test`: 270 pass / 0 fail。
- `pnpm typecheck`: pass。
- `pnpm dashboard:build`: pass。
- `git diff --check`: pass。

### Milestone 5

- `node --import tsx --test tests/topic-fact-pack.test.ts tests/article-writer.test.ts tests/title-generator.test.ts tests/article-reviewer.test.ts tests/cover-image.test.ts tests/real-data-audit.test.ts tests/wechat-api-draft.test.ts`
- `pnpm test`
- `pnpm typecheck`
- `pnpm dashboard:build`
- `git diff --check`

2026-07-13 当前结果：

- Milestone 5 影响范围：54 pass / 0 fail。
- `pnpm test`: 270 pass / 0 fail。
- `pnpm typecheck`: pass。
- `pnpm dashboard:build`: pass。
- `git diff --check`: pass。

### Milestone 6

- `node --import tsx --test tests/article-reviewer.test.ts tests/editorial-brief-flow.test.ts tests/title-generator.test.ts tests/article-writer.test.ts tests/editorial-plan.test.ts`
- `pnpm test`
- `pnpm typecheck`
- `pnpm dashboard:build`
- `git diff --check`

2026-07-13 当前结果：

- Milestone 6 影响范围：28 pass / 0 fail。
- `pnpm test`: 272 pass / 0 fail。
- `pnpm typecheck`: pass。
- `pnpm dashboard:build`: pass。
- `git diff --check`: pass。

### Milestone 8

- `node --import tsx --test tests/article-reviewer.test.ts tests/policy-registry.test.ts`
- `node --import tsx --test tests/editorial-brief-flow.test.ts tests/title-generator.test.ts tests/article-reviewer.test.ts`
- `pnpm test`
- `pnpm typecheck`
- `pnpm dashboard:build`
- `git diff --check`

2026-07-13 当前结果：

- ReviewPolicy targeted：14 pass / 0 fail。
- Flow/title/review targeted：21 pass / 0 fail。
- `pnpm test`: 274 pass / 0 fail。
- `pnpm typecheck`: pass。
- `pnpm dashboard:build`: pass。
- `git diff --check`: pass。

### Milestone 9

- `node --import tsx --test tests/dashboard-api.test.ts tests/editorial-brief-flow.test.ts tests/title-generator.test.ts`
- `pnpm test`
- `pnpm typecheck`
- `pnpm dashboard:build`
- `git diff --check`

2026-07-13 当前结果：

- Dashboard / layout targeted：50 pass / 0 fail。
- `pnpm test`: 275 pass / 0 fail。
- `pnpm typecheck`: pass。
- `pnpm dashboard:build`: pass。
- `git diff --check`: pass。

### Final Audit

- `rg -n "Claude Code|Goose|coding agent|免费平替|\\$200|200/month|工具锁定|工作流入口|开源替代|高价编码代理|编码代理真正|claude code|goose|isClaude|claudeCode" src apps config -g '*.ts' -g '*.tsx' -g '*.json' -g '*.md'`
- `node --import tsx --test tests/topic-fixtures.test.ts tests/topic-profile.test.ts tests/article-writer.test.ts tests/article-reviewer.test.ts tests/title-generator.test.ts tests/editorial-brief-flow.test.ts tests/dashboard-api.test.ts tests/cover-image.test.ts tests/wechat-html-layout.test.ts tests/topic-fact-pack.test.ts tests/editorial-plan.test.ts tests/research-plan.test.ts tests/policy-registry.test.ts`
- `pnpm test`
- `pnpm typecheck`
- `pnpm dashboard:build`
- `git diff --check`

2026-07-13 最终结果：

- 生产路径旧专题耦合搜索：仅剩固定专名白名单和通用禁止词 guard；Claude/Goose 旧专题负例保留在 tests。
- Final targeted：103 pass / 0 fail。
- `pnpm test`: 275 pass / 0 fail。
- `pnpm typecheck`: pass。
- `pnpm dashboard:build`: pass。
- `git diff --check`: pass。

### Milestone 7

- `node --import tsx --test tests/title-generator.test.ts tests/editorial-brief-flow.test.ts`
- `pnpm test`
- `pnpm typecheck`
- `pnpm dashboard:build`
- `git diff --check`

2026-07-13 当前结果：

- Milestone 7 影响范围：13 pass / 0 fail。
- `pnpm test`: 273 pass / 0 fail。
- `pnpm typecheck`: pass。
- `pnpm dashboard:build`: pass。
- `git diff --check`: pass。

### Future Milestones

- TopicProfile:
  - DONE: 12 类 fixture 生成不同 `TopicProfile`。
  - DONE: 非 coding agent 题不归类为 coding agent 对比。
  - DONE: 真实 LLM JSON repair 失败进入 `other`。
- Policy:
  - DONE: pricing launch 同时命中 product-launch + pricing。
  - DONE: benchmark 命中性能和厂商自测风险。
  - DONE: regulation 不命中 pricing。
- Research/Evidence:
  - DONE: search lead 不能单独支持 verified claim。
  - DONE: 已接入受限 HTTP/HTML 正文抽取；只允许 http/https，阻断 localhost、loopback、私网、非文本 content-type、超时、过大正文和不安全跳转。
  - DONE: 可用正文会保存 task-linked evidence snippets；不可用来源保持 metadata-only / failed，不会伪装为正文证据。
  - DONE: 不可可靠核验时不会自动补全 verified claim，claim 数字必须能在 evidence snippet 中找到。
- FactPack:
  - DONE: DynamicFactPack claim 必须有 `id`、`status`、`evidenceIds`、`safeWording`、`forbiddenWording`。
  - DONE: 生产 JSON 不再写入 `comparison` 字段。
  - DONE: 非相关题目不出现旧专题实体和价格。
  - Remaining: 真正 verified claim 需要后续 SourceEvidence 抓取或人工证据输入。
- Article:
  - DONE: 论文、融资、政策、产品、定价、benchmark、事故、案例结构不同。
  - DONE: 每个 section 在 EditorialPlan 中声明 allowedClaimIds，文章 meta 写入 sectionClaimMap。
  - Remaining: real LLM 返回内容仍需在 ReviewPolicy 阶段做更细的 section-level blocking。
- Title:
  - DONE: 标题数字必须来自 claim，否则产生 violation。
  - DONE: forbiddenWording 必须拦截。
  - DONE: 标题候选记录 sourceClaimIds 和 matchedThemes。
  - Remaining: Dashboard 标题界面尚未展示 claim 支撑信息。
- Review:
  - DONE: blocking rule 让 passed=false。
  - DONE: LLM 不能覆盖代码 blocking。
  - DONE: ReviewPolicy / fact pack forbiddenWording / local rule 都有来源追踪。

## Key Design Decisions

- Milestone 1 不删除旧业务逻辑，只建立可回归的多题型测试面。
- 旧 Claude Code / Goose 测试保留为 legacy coverage，后续降级为普通 fixture。
- 搜索摘要在所有设计中只能作为 `search_lead`，不能单独支撑 verified claim。
- Real Topic Regression Repair 已实现受限 HTTP 抓取，并保留协议、私网、timeout、大小、content-type 和 redirect 防护；失败页面只记录不可用原因。
- Milestone 5 保留 `topic-fact-pack.json` 文件名，避免一次性破坏下游；通过 `schemaVersion: "2.0"` 表示结构升级。
- Milestone 5 暂保留 `verifiedClaims` 兼容投影，原因是文章 usedClaims、审核、封面、审计和草稿预检仍读取该字段；后续迁移完成后再考虑删除。
- 旧 Claude/Goose 安全规则中能防止绝对化和价格误导的部分已收敛为动态 claim / review policy / 通用 forbidden terms。
- Milestone 6 新增 `editorial-plan.json`，但仍保留 `article-meta.json` 作为后续阶段读取入口；section claim map 先写入 meta 以兼容审核和标题生成。
- Milestone 6 不新增 LLM stage，EditorialPlan 使用 deterministic policy/template 生成，避免在文章前增加新的真实 API 依赖。
- Milestone 7 不新增文件名，继续写 `title-candidates.json`，但候选结构增加 trace 字段；Dashboard 现有 JSON 读取可兼容。
- Final audit 后，旧 Claude/Goose 相关内容只作为测试负例或固定专名白名单存在；默认 mock 资讯、生产 prompt、封面 prompt、HTML rewrite、技能说明均不再绑定旧专题。
- 不引入浏览器自动化、数据库接入或真实微信写入改造。
- 不修改真实草稿双开关和 publish/mass-send guard。

## Follow-up Questions

- DynamicFactPack 的 `verifiedClaims` 兼容投影应长期保留给外部审计和草稿预检，还是在下游完全迁移到 `claims` 后删除。
- SourceEvidence 后续是否引入受限 HTTP 抓取，或优先支持人工上传证据包。
- Dashboard 标题选择界面是否展示 `sourceClaimIds` / `matchedThemes`，方便人工确认标题支撑。
