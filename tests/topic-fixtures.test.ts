import assert from "node:assert/strict";
import test from "node:test";
import { topicFixtures } from "./fixtures/topicFixtures.js";

const requiredCategories = [
  "新模型发布",
  "产品功能更新",
  "AI 工具定价",
  "benchmark 对比",
  "研究论文",
  "开源项目",
  "创业融资",
  "企业并购",
  "政策法规",
  "安全事故",
  "企业应用案例",
  "AI 创作者工具"
];

test("topic fixtures cover the milestone 1 topic matrix", () => {
  assert.ok(topicFixtures.length >= 12);

  for (const category of requiredCategories) {
    assert.ok(
      topicFixtures.some((fixture) => fixture.category === category),
      `missing topic fixture category: ${category}`
    );
  }
});

test("topic fixtures define profile expectations without legacy coding-agent pollution", () => {
  for (const fixture of topicFixtures) {
    assert.ok(fixture.inputTopic.title.trim(), `${fixture.id} title is required`);
    assert.ok(fixture.inputTopic.summary.trim(), `${fixture.id} summary is required`);
    assert.match(fixture.inputTopic.sourceUrl, /^https:\/\//, `${fixture.id} needs source URL`);
    assert.ok(fixture.expectedPrimaryDomain, `${fixture.id} primary domain is required`);
    assert.ok(fixture.expectedEventTypes.length > 0, `${fixture.id} event types are required`);
    assert.ok(
      fixture.expectedRiskDimensions.length > 0,
      `${fixture.id} risk dimensions are required`
    );
    assert.ok(fixture.expectedContentMode, `${fixture.id} content mode is required`);
    assert.ok(
      fixture.forbiddenUnrelatedConcepts.length > 0,
      `${fixture.id} forbidden concepts are required`
    );

    const combinedTopicText = [
      fixture.inputTopic.title,
      fixture.inputTopic.summary,
      fixture.expectedPrimaryDomain,
      ...fixture.expectedEventTypes,
      ...fixture.expectedRiskDimensions,
      fixture.expectedContentMode
    ].join("\n");

    for (const forbidden of fixture.forbiddenUnrelatedConcepts) {
      assert.doesNotMatch(
        combinedTopicText,
        new RegExp(forbidden.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
        `${fixture.id} should not include unrelated concept: ${forbidden}`
      );
    }
  }
});

test("topic fixtures exercise multiple domains, event types, risks, and content modes", () => {
  const domains = new Set(topicFixtures.map((fixture) => fixture.expectedPrimaryDomain));
  const eventTypes = new Set(
    topicFixtures.flatMap((fixture) => fixture.expectedEventTypes)
  );
  const riskDimensions = new Set(
    topicFixtures.flatMap((fixture) => fixture.expectedRiskDimensions)
  );
  const contentModes = new Set(topicFixtures.map((fixture) => fixture.expectedContentMode));

  assert.ok(domains.size >= 8, `expected at least 8 domains, got ${domains.size}`);
  assert.ok(eventTypes.size >= 10, `expected at least 10 event types, got ${eventTypes.size}`);
  assert.ok(
    riskDimensions.size >= 24,
    `expected broad risk coverage, got ${riskDimensions.size}`
  );
  assert.ok(
    contentModes.size >= 5,
    `expected at least 5 content modes, got ${contentModes.size}`
  );
});
