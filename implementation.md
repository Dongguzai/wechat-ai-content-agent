# Dynamic Content Engine Implementation

## Final Goal

将当前偏 Claude Code / Goose 专题的内容生产链路，逐步重构为根据不同选题动态生成选题画像、调研计划、来源证据、事实包、编辑策略、文章结构、标题策略和审核规则的通用内容引擎。

目标数据流：

```text
确认选题
→ TopicProfile
→ ResearchPlan
→ SourceEvidence
→ DynamicFactPack
→ EditorialPlan
→ 动态文章
→ 动态标题
→ ReviewPolicy
→ 文章审核
```

## Current Architecture

- `runDailyPipeline` 先生成 brief 并停在人工确认前；`--from article` 后生成 TopicProfile、ResearchPlan、SourceEvidence、DynamicFactPack、EditorialPlan、文章、标题、审核、封面、HTML 排版和 mock 草稿。
- `selectTopic` 和 `shortlistNews` 已改为基于 category / tags / source / evidence 的通用选题画像和角度生成，不再对 Claude Code / Goose 等固定专题开专属分支。
- `buildTopicFactPack` 输出 `schemaVersion: "2.0"` 的 DynamicFactPack；生产 JSON 不再包含 `comparison.claudeCode/goose`。
- `writeArticle` 按 `editorial-plan.sections` 和 `allowedClaimIds` 动态生成正文，并校验 DynamicFactPack 的 `forbiddenWording`。
- `generateTitles` 根据正文、EditorialPlan requiredThemes 和 DynamicFactPack claims 生成标题，并要求数字和强事实有 claim 支撑。
- `reviewArticle` 由 ReviewPolicy、fact pack forbiddenWording、unsupported/conflicting claims 和本地通用规则共同驱动；LLM 辅助审稿不能覆盖本地阻断。
- Dashboard 已读取并展示动态产物状态；`--from layout` 会阻断缺失或 topicId 不一致的动态产物，防止复用旧 outputs。

## Baseline

2026-07-13 初始只读检查后运行：

- `pnpm test`: DONE，251 pass / 0 fail。
- `pnpm typecheck`: DONE。
- `pnpm dashboard:build`: DONE。
- `git diff --check`: DONE。

基线无已知失败。后续失败默认视为本次改造引入，除非另有记录。

## Key Problems

- DONE: 正式生产代码已移除 Claude Code / Goose 专题识别、固定角度和固定 comparison 结构。
- DONE: “开源 / 工作流 / 成本 / 工具锁定”不再作为通用必备主题；文章和审核优先使用 EditorialPlan requiredThemes。
- DONE: 标题和审核安全规则已拆为通用禁止词、DynamicFactPack forbiddenWording 和配置化 ReviewPolicy。
- DONE: SourceEvidence 已存在并保持 metadata-only，不把 search lead 升级为 verified claim。
- Remaining: 真正 verified claim 仍需要后续受限抓取、人工证据包或更强证据输入机制；当前实现会保守标注证据状态。

## Milestones

| Milestone | Status | Notes |
| --- | --- | --- |
| 1. 解除专属选题耦合并建立测试基线 | DONE | 已完成基线、耦合点盘点、12 类选题 fixture 和全量验证。 |
| 2. TopicProfile 选题画像 | DONE | 已新增类型、分类器、输出、LLM stage 配置并接入 `--from article`。 |
| 3. Policy Registry | DONE | 已新增配置驱动 registry、三类 policy 目录和匹配测试。 |
| 4. ResearchPlan 和 SourceEvidence | DONE | 已新增动态调研计划、metadata-only 来源证据产物并接入 `--from article`。 |
| 5. DynamicFactPack | DONE | 已移除生产结构中的 Claude/Goose 专属 comparison，并保留 `verifiedClaims` 兼容投影。 |
| 6. EditorialPlan 和文章生成 | DONE | 已新增 `editorial-plan` 产物，文章按 section allowedClaimIds 动态生成。 |
| 7. 动态标题体系 | DONE | 标题已根据 FactPack、EditorialPlan、正文和动态主题生成与评分。 |
| 8. ReviewPolicy 和审核 | DONE | 审核 issue 已追踪 ruleId / policyId / source / blocking，并由动态 ReviewPolicy + fact pack forbiddenWording 驱动。 |
| 9. 完整接入流水线和 Dashboard | DONE | Dashboard 已读取动态产物，`--from layout` 已校验动态产物完整性和 topicId 一致性。 |
| 10. 最终去耦审计 | DONE | 生产路径旧专题分支已收敛；剩余 Claude/Goose 仅出现在固定专名白名单或测试负例中，通用禁止词继续作为安全 guard。 |

## Completed

- DONE: 阅读 AGENTS、README、package、LLM JSON、主流水线、选题、事实包、文章、标题、审核、Dashboard 数据/action/workflow 文件。
- DONE: 建立基线记录，初始测试、类型检查、Dashboard build 和 diff check 全部通过。
- DONE: 搜索并分类 Claude Code / Goose / 价格 / 免费平替 / 工具锁定等写死内容。
- DONE: 新增 `tests/fixtures/topicFixtures.ts`，覆盖 12 类选题。
- DONE: 新增 `tests/topic-fixtures.test.ts`，验证 fixture 覆盖面、字段完整性和旧专题污染词隔离。
- DONE: Milestone 1 验证通过：`pnpm test` 254 pass / 0 fail，`pnpm typecheck` 通过，`git diff --check` 通过。
- DONE: 新增 `src/types/topicProfile.ts` 和 `src/pipeline/classifyTopic.ts`。
- DONE: `topic-classifier` 已加入 LLM 阶段配置，支持 MiniMax JSON + repair retry。
- DONE: deterministic mock 分类器覆盖 12 类 fixture；真实分类失败会落入 `other` + 低置信度保守模式。
- DONE: `runDailyPipeline --from article` 已在旧 FactPack 前生成 `outputs/topic-profile.json` 和 `outputs/topic-profile-report.md`，旧 FactPack 继续运行。
- DONE: Milestone 2 验证通过：`pnpm test` 260 pass / 0 fail，`pnpm typecheck` 通过，`git diff --check` 通过。
- DONE: 新增 `src/config/policyRegistry.ts`，从配置目录加载 research/editorial/review policy。
- DONE: 新增 `config/research-policies/`、`config/editorial-patterns/`、`config/review-policies/`，覆盖 product-launch、model-benchmark、pricing、funding、acquisition、regulation、research-release、security-incident、case-study、generic-safe。
- DONE: Policy 匹配按 `primaryDomain`、`eventTypes`、`riskDimensions` 动态组合；声明的维度必须全部命中，避免政策题误加载定价规则。
- DONE: 无匹配时按 scope 加载 `generic-safe`；每条 policy 保留 `id`、`version`、`scope`、`sourcePath` 和 `matchReasons` 以便后续审核追踪。
- DONE: Milestone 3 验证通过：`pnpm test` 266 pass / 0 fail，`pnpm typecheck` 通过，`git diff --check` 通过。
- DONE: 新增 `src/types/researchPlan.ts`、`src/types/sourceEvidence.ts`、`src/pipeline/buildResearchPlan.ts`、`src/pipeline/collectSourceEvidence.ts`。
- DONE: ResearchPlan 根据 TopicProfile + research policies 生成题型差异化任务，覆盖发布、benchmark、定价、融资、并购、政策、事故、论文和案例等事件类型。
- DONE: SourceEvidence 当前采用 `metadata_only` 模式，不做 HTTP 抓取、不做浏览器自动化、不伪造网页正文；search lead 明确 `canSupportVerifiedClaim=false`。
- DONE: `runDailyPipeline --from article` 已在旧 FactPack 前生成 `outputs/research-plan.json`、`outputs/research-plan-report.md`、`outputs/source-evidence.json`、`outputs/source-evidence-report.md`。
- DONE: Milestone 4 验证通过：`pnpm test` 270 pass / 0 fail，`pnpm typecheck` 通过，`git diff --check` 通过。
- DONE: `TopicFactPack` 升级为 `schemaVersion: "2.0"`，新增 `claims`、`unsupportedClaims`、`conflictingClaims`、`entities`、`sourceReliabilityReason`、`sourceEvidenceIds`。
- DONE: `buildTopicFactPack` 改为使用 TopicProfile、ResearchPlan 和 SourceEvidence；无证据文件时使用保守 fallback，不伪造网页抓取或 verified claim。
- DONE: 生产结构已移除 `comparison.claudeCode/goose`，旧 Claude/Goose 题目作为普通选题通过动态 claim 表达。
- DONE: `verifiedClaims` 暂保留为兼容投影，供文章 usedClaims、审核、封面、审计和草稿预检链路继续读取。
- DONE: `writeArticle`、`generateTitles`、`reviewArticle` 已从 `comparison.unsafeComparisonClaims` 切换到 `claims[].forbiddenWording`，并收窄旧价格审核正则避免 URL slug 误报。
- DONE: Milestone 5 影响范围验证通过：`node --import tsx --test tests/topic-fact-pack.test.ts tests/article-writer.test.ts tests/title-generator.test.ts tests/article-reviewer.test.ts tests/cover-image.test.ts tests/real-data-audit.test.ts tests/wechat-api-draft.test.ts`，54 pass / 0 fail。
- DONE: Milestone 5 全量验证通过：`pnpm test` 270 pass / 0 fail，`pnpm typecheck` 通过，`pnpm dashboard:build` 通过，`git diff --check` 通过。
- DONE: 新增 `src/types/editorialPlan.ts` 和 `src/pipeline/buildEditorialPlan.ts`，按 TopicProfile、ResearchPlan、DynamicFactPack 和 editorial policies 生成动态文章结构。
- DONE: `runDailyPipeline --from article` 已在 FactPack 后生成 `outputs/editorial-plan.json` 和 `outputs/editorial-plan.md`，文章阶段变为 11 步。
- DONE: `writeArticle` 已读取 EditorialPlan，根据 `sections[].allowedClaimIds` 生成段落，并在 `article-meta.json` 写入 `editorialPlan.sectionClaimMap` 和动态 `requiredThemes`。
- DONE: 真实 LLM 写作 prompt 已加入 EditorialPlan 结构和 claim id 约束；mock 写作不再固定五段旧专题结构。
- DONE: `reviewArticle` 已读取 `articleMeta.editorialPlan.requiredThemes`，并优先用 `usedClaim.id` 匹配 DynamicFactPack claim。
- DONE: Milestone 6 影响范围验证通过：`node --import tsx --test tests/article-reviewer.test.ts tests/editorial-brief-flow.test.ts tests/title-generator.test.ts tests/article-writer.test.ts tests/editorial-plan.test.ts`，28 pass / 0 fail。
- DONE: Milestone 6 全量验证通过：`pnpm test` 272 pass / 0 fail，`pnpm typecheck` 通过，`pnpm dashboard:build` 通过，`git diff --check` 通过。
- DONE: `generateTitles` 新增动态标题策略，候选标题根据 `articleMeta.editorialPlan.requiredThemes`、正文、选题和 DynamicFactPack claims 生成。
- DONE: `TitleCandidate` 新增 `sourceClaimIds` 和 `matchedThemes`，标题报告输出 claim 支撑和主题命中。
- DONE: 标题评分会拦截未被 claim 支撑的数字、价格、benchmark、融资、监管、事故等强事实。
- DONE: 真实 LLM 标题候选仍走本地动态评分和 forbiddenWording 检查，不能绕过安全规则。
- DONE: Milestone 7 影响范围验证通过：`node --import tsx --test tests/title-generator.test.ts tests/editorial-brief-flow.test.ts`，13 pass / 0 fail。
- DONE: Milestone 7 全量验证通过：`pnpm test` 273 pass / 0 fail，`pnpm typecheck` 通过，`pnpm dashboard:build` 通过，`git diff --check` 通过。
- DONE: `ArticleReviewIssue` 新增 `ruleId`、`policyId`、`source`、`blocking`，审核报告显示每条问题的规则来源和是否阻断。
- DONE: `reviewArticle` 已读取 `topic-profile.json` 或显式 `topicProfile`，通过 `config/review-policies/policies.json` 解析动态 ReviewPolicy。
- DONE: fact boundary 从写死 Claude/Goose 正则迁移为 `TopicFactPack.claims[].forbiddenWording`、`unsupportedClaims` 和 `conflictingClaims` 派生，保留否定/风险控制语境豁免。
- DONE: ReviewPolicy 已覆盖无来源数字、pricing 零成本/API 订阅混淆、benchmark 绝对胜负、regulation 跨辖区泛化、security incident 夸大影响、research release 泛化等动态题型风险。
- DONE: `claimIsReflectedSafely` 和未追踪事实检查已改为 claim id / forbiddenWording / fact pack claim 驱动，不再硬编码 Claude/Goose 专题语义。
- DONE: 真实 LLM 辅助审稿只追加 `auxiliary_llm` 非阻断建议；最终 passed/blocked 由本地 `fact_pack` / `review_policy` / `local_rule` 硬规则决定。
- DONE: Milestone 8 影响范围验证通过：`node --import tsx --test tests/editorial-brief-flow.test.ts tests/title-generator.test.ts tests/article-reviewer.test.ts`，21 pass / 0 fail。
- DONE: Milestone 8 全量验证通过：`pnpm test` 274 pass / 0 fail，`pnpm typecheck` 通过，`pnpm dashboard:build` 通过，`git diff --check` 通过。
- DONE: Dashboard status API 已读取 `topic-profile.json`、`research-plan.json`、`source-evidence.json`、`editorial-plan.json` 和 `article-review.reviewPolicies`。
- DONE: Dashboard steps 已展示选题画像、调研计划、来源证据、编辑计划和审核策略状态。
- DONE: 文章工作台侧栏已展示动态画像、调研任务数、来源证据数、编辑段落数和审核策略摘要。
- DONE: `--from layout` 阶段已要求动态产物齐全，并校验 `topicId` / `editorialPlan.id`，避免跨选题复用旧 outputs。
- DONE: Milestone 9 影响范围验证通过：`node --import tsx --test tests/dashboard-api.test.ts tests/editorial-brief-flow.test.ts tests/title-generator.test.ts`，50 pass / 0 fail。
- DONE: Milestone 9 全量验证通过：`pnpm test` 275 pass / 0 fail，`pnpm typecheck` 通过，`pnpm dashboard:build` 通过，`git diff --check` 通过。
- DONE: 最终审计已移除 `selectTopic`、`shortlistNews`、`writeArticle`、`generateTitles`、`reviewArticle`、`generateCover`、`renderWechatHtml`、Dashboard cover workflow 和 `src/skills/*` 中的旧专题生产耦合。
- DONE: 默认 mock 首条资讯已改为通用企业智能体治理题，不再把 dry-run 默认演示绑定到 Claude/Goose。
- DONE: 封面审核已避免把 `No real brand logos` 等负向安全约束误判为请求官方标识。
- DONE: 写作校验已接入 DynamicFactPack `claims[].forbiddenWording`，不再只依赖全局硬编码 forbidden phrases。
- DONE: 最终 targeted 验证通过：`node --import tsx --test tests/topic-fixtures.test.ts tests/topic-profile.test.ts tests/article-writer.test.ts tests/article-reviewer.test.ts tests/title-generator.test.ts tests/editorial-brief-flow.test.ts tests/dashboard-api.test.ts tests/cover-image.test.ts tests/wechat-html-layout.test.ts tests/topic-fact-pack.test.ts tests/editorial-plan.test.ts tests/research-plan.test.ts tests/policy-registry.test.ts`，103 pass / 0 fail。
- DONE: 最终全量验证通过：`pnpm test` 275 pass / 0 fail，`pnpm typecheck` 通过，`pnpm dashboard:build` 通过，`git diff --check` 通过。

## Current Blockers

- BLOCKED: 无。

## Real Topic Regression Repair Goal (2026-07-13)

目标：修复上一轮真实选题回归中暴露的公众号闭环阻断问题，在不降低 fact / review / WeChat 安全强度的前提下，让六类真实选题重新跑到 Cover、WeChat HTML 和 mock draft dry-run。

### Repair Baseline

- 上一轮真实回归：`FAIL`。
- 失败点：
  - `regression-product-001`: Writer 触发 `零成本` forbiddenWording。
  - `regression-benchmark-001`: Writer 触发 `全面领先` forbiddenWording。
  - `regression-pricing-001`: 文章 1547 字符，超过 1500 硬上限。
  - `regression-business-001`: 文章审核未通过，封面被阻断。
  - `regression-policy-001`: 文章 1608 字符，超过 1500 硬上限。
  - `regression-research-001`: Writer 触发 `已经证明` forbiddenWording。
- 共同证据问题：`SourceEvidence.collectionMode=metadata_only`，`FactPack verified=0`。
- 2026-07-13 修复前基线：
  - `pnpm test`: 275 pass / 0 fail。
  - `pnpm typecheck`: pass。
  - `pnpm dashboard:build`: pass。
  - `git diff --check`: pass。

### Repair Milestones

| Milestone | Status | Notes |
| --- | --- | --- |
| R1. 干净可复核基线 | DONE | 已记录工作区已有通用化改动、上一轮失败报告和修复前测试基线；不清理、不回滚用户既有改动。 |
| R2. SourceEvidence 正文证据 | DONE | 已接入安全 HTTP/HTML 读取、正文清洗、snippet 提取和 task 绑定；私网/localhost/非 http(s)/超时/过大正文/不支持 content-type 会明确不可用。 |
| R3. FactPack 证据绑定 | DONE | verified 必须绑定 usable evidence snippet；metadata/search lead 不得单独支撑 verified，claim 数字必须能在 snippet 中找到。 |
| R4. Writer 约束和 repair | DONE | 已接入结构化 claims / qualifiers / forbiddenWording / allowed numbers / target length，并写出 attempt/repair/validation 记录。 |
| R5. business 审核根因 | DONE | 根因转为 metadata-only 来源下的谨慎表达和 auxiliary 审稿误阻断；已改为本地硬规则决定 blocking，并补事实/限定语/政策边界注入测试。 |
| R6. Cover/HTML/draft dry-run 连通 | DONE | 六类真实选题文章审核通过后均生成封面、WeChat HTML 和 mock draft dry-run。 |
| R7. v2 六题回归和故障注入 | DONE | 已输出 `outputs/regression-runs-v2/`、`reports/real-topic-regression-v2-report.md/json` 和故障注入报告。 |

### Repair Final Result

- `outputs/regression-runs-v2/`: 6/6 完成到 `draft-dry-run`。
- `reports/real-topic-regression-v2-report.md`: 总体 `PASS`。
- 故障注入：FactPack 外数字、删除必要限定语、政策边界缺失均 `PASS_BLOCKED`。
- 最终验证：`pnpm test` 277 pass / 0 fail，`pnpm typecheck` pass，`pnpm dashboard:build` pass，`git diff --check` pass。
- 微信安全边界：未调用真实微信草稿 API，未发布，未群发。

## Next Step

1. 可选后续：逐步减少 `verifiedClaims` 兼容投影的下游依赖。
2. 可选后续：为 SourceEvidence 增加受限抓取或人工证据包输入，让更多 claim 能达到真正 verified 状态。
3. 可选后续：Dashboard 标题候选展示 `sourceClaimIds` / `matchedThemes`，方便人工选择标题时看见支撑来源。

## Remaining Risks

- `verifiedClaims` 仍是兼容字段，主要用于草稿、封面、审计等旧接口兼容；最终审计确认它不再强迫生产结构回到旧专题 comparison。
- Dashboard 的 `JsonObject = Record<string, any>` 是既有实现，动态产物展示时应避免继续扩大 `any` 范围。
- 旧安全规则中保留下来的部分已收敛为通用反夸大和价格误导 guard；迁移后审核强度没有降低。
- 微信草稿 API、浏览器和发布安全 guardrails 必须保持不变。
