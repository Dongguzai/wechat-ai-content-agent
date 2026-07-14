import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  loadPolicyRegistry,
  resolvePoliciesForProfile,
  selectPoliciesForProfile,
  type PolicyScope,
  type ResolvedPolicy
} from "../src/config/policyRegistry.js";
import type { TopicProfile } from "../src/types/topicProfile.js";

function profile(overrides: Partial<TopicProfile>): TopicProfile {
  return {
    schemaVersion: "1.0",
    id: "topic-profile-test",
    topicId: "topic-test",
    primaryDomain: "other",
    secondaryDomains: [],
    eventTypes: ["opinion"],
    entities: [],
    targetAudiences: ["普通 AI 关注者"],
    readerQuestions: ["这件事是否可靠？"],
    evidenceNeeds: ["原始来源"],
    riskDimensions: ["事实边界"],
    recommendedContentMode: "news_analysis",
    confidence: 0.5,
    classificationReason: "test profile",
    generatedAt: "2026-07-13T00:00:00.000Z",
    ...overrides
  };
}

function ids(policies: ResolvedPolicy[], scope: PolicyScope): string[] {
  return policies
    .filter((policy) => policy.scope === scope)
    .map((policy) => policy.id)
    .sort();
}

test("policy registry loads config-driven policies with traceable sources", async () => {
  const registry = await loadPolicyRegistry({
    now: new Date("2026-07-13T00:00:00.000Z")
  });

  assert.equal(registry.loadedAt, "2026-07-13T00:00:00.000Z");
  assert.ok(registry.policies.length >= 30);

  for (const scope of ["research", "editorial", "review"] as const) {
    const scoped = registry.policies.filter((policy) => policy.scope === scope);
    assert.ok(scoped.length >= 10, `${scope} should have at least 10 policies`);
    assert.ok(scoped.some((policy) => policy.id === "generic-safe"));
    for (const policy of scoped) {
      assert.ok(policy.id);
      assert.ok(policy.version);
      assert.ok(policy.sourcePath.startsWith(`${scope === "editorial" ? "editorial-patterns" : `${scope}-policies`}/`));
      assert.ok(policy.instructions.length > 0);
      assert.ok(policy.riskRules.length > 0);
    }
  }
});

test("pricing launch profile loads product-launch and pricing policies together", async () => {
  const policies = await resolvePoliciesForProfile(
    profile({
      primaryDomain: "product",
      eventTypes: ["launch", "pricing"],
      riskDimensions: ["币种", "生效日期", "订阅与 API 差异", "免费层边界"]
    }),
    { scopes: ["research"] }
  );
  const selectedIds = ids(policies, "research");

  assert.deepEqual(selectedIds, ["pricing", "product-launch"]);
  assert.ok(
    policies.every((policy) =>
      policy.matchReasons.some(
        (reason) => reason.startsWith("eventType:") || reason.startsWith("riskDimension:")
      )
    )
  );
});

test("benchmark profile loads benchmark policy with performance and vendor-self-test risks", async () => {
  const policies = await resolvePoliciesForProfile(
    profile({
      primaryDomain: "research",
      eventTypes: ["benchmark", "research_release"],
      riskDimensions: ["指标定义", "测试条件", "厂商自测", "第三方复现"]
    }),
    { scopes: ["review"] }
  );
  const selectedIds = ids(policies, "review");

  assert.ok(selectedIds.includes("model-benchmark"));
  const benchmark = policies.find((policy) => policy.id === "model-benchmark");
  assert.ok(benchmark);
  assert.ok(benchmark.matchReasons.includes("riskDimension:厂商自测"));
  assert.ok(benchmark.riskRules.some((rule) => rule.includes("全面领先")));
});

test("regulation profile does not load pricing policy even when both mention effective dates", async () => {
  const policies = await resolvePoliciesForProfile(
    profile({
      primaryDomain: "policy",
      eventTypes: ["regulation"],
      riskDimensions: ["司法辖区", "生效时间", "适用对象", "实际义务"]
    }),
    { scopes: ["research", "editorial", "review"] }
  );

  assert.ok(ids(policies, "research").includes("regulation"));
  assert.ok(ids(policies, "editorial").includes("regulation"));
  assert.ok(ids(policies, "review").includes("regulation"));
  assert.ok(!policies.some((policy) => policy.id === "pricing"));
});

test("policy registry uses generic-safe fallback per requested scope", async () => {
  const registry = await loadPolicyRegistry();
  const selected = selectPoliciesForProfile({
    registry,
    profile: profile({
      primaryDomain: "other",
      eventTypes: ["opinion"],
      riskDimensions: ["无法归类"]
    }),
    scopes: ["research", "review"]
  });

  assert.deepEqual(ids(selected, "research"), ["generic-safe"]);
  assert.deepEqual(ids(selected, "review"), ["generic-safe"]);
  assert.ok(
    selected.every((policy) => policy.matchReasons.includes("fallback:generic-safe"))
  );
});

test("policy registry reports invalid config with explicit parse error", async () => {
  const configRoot = await mkdtemp(join(tmpdir(), "policy-registry-invalid-"));

  try {
    await Promise.all([
      mkdir(join(configRoot, "research-policies"), { recursive: true }),
      mkdir(join(configRoot, "editorial-patterns"), { recursive: true }),
      mkdir(join(configRoot, "review-policies"), { recursive: true })
    ]);
    await writeFile(join(configRoot, "research-policies", "bad.json"), "{", "utf8");

    await assert.rejects(
      () => loadPolicyRegistry({ configRoot, scopes: ["research"] }),
      /Policy config parse failed for research-policies\/bad\.json/
    );
  } finally {
    await rm(configRoot, { recursive: true, force: true });
  }
});
