import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { generateEditorialBrief } from "../src/pipeline/generateEditorialBrief.js";
import { runDailyPipeline } from "../src/pipeline/runDailyPipeline.js";
import type { EditorialBrief } from "../src/types/editorial.js";
import type { Logger } from "../src/utils/logger.js";

const silentLogger: Logger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined
};

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function writeApproval(
  path: string,
  value: {
    approvedByUser: boolean;
    approvedTopicId: string;
    approvedTitle?: string;
    notes?: string;
  }
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(
    path,
    `${JSON.stringify(
      {
        approvedTitle: "",
        notes: "",
        ...value
      },
      null,
      2
    )}\n`,
    "utf8"
  );
}

async function runBrief(outputDir: string) {
  return runDailyPipeline({
    outputDir,
    until: "brief",
    useMockRss: true,
    logger: silentLogger,
    env: {
      SEARCH_ENABLE_REAL_API: "false",
      WECHAT_DRAFT_DRY_RUN: "true",
      WECHAT_API_ENABLE_REAL_DRAFT: "false",
      WECHAT_DRAFT_ALLOW_REAL_API: "false"
    },
    now: new Date("2026-05-29T00:00:00.000Z")
  });
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function countShortlistedMarkdownItems(markdown: string): number {
  const section = markdown.split("## 二、AI 推荐今日主选题")[0] ?? "";
  return section.match(/^### \d+\. /gm)?.length ?? 0;
}

test("--until brief generates editorial brief and stops before article/cover/wechat API", async () => {
  const root = await mkdtemp(join(tmpdir(), "editorial-brief-"));
  const outputDir = join(root, "outputs");

  try {
    const result = await runBrief(outputDir);
    const brief = JSON.parse(
      await readFile(join(outputDir, "editorial-brief.json"), "utf8")
    ) as EditorialBrief;
    const markdown = await readFile(join(outputDir, "editorial-brief.md"), "utf8");

    assert.equal(result.stoppedAt, "brief");
    assert.equal(brief.candidates.length, 20);
    assert.equal(brief.shortlistedItems.length, 10);
    assert.equal(brief.shortlisted.length, 10);
    assert.equal(brief.runnersUp.length, 2);
    assert.equal(brief.approvalRequired, true);
    assert.equal(
      brief.nextStep,
      "Read the 10 shortlisted source URLs, then edit inputs/editorial-approval.json."
    );
    assert.ok(brief.recommendedTopic.id);
    assert.match(markdown, /^# 今日 AI 资讯编辑简报/m);
    assert.match(markdown, /## 一、今日 10 条入围资讯阅读清单/);
    assert.match(markdown, /## 二、AI 推荐今日主选题/);
    assert.match(markdown, /## 三、备选主题 2 条/);
    assert.match(markdown, /## 四、人工确认建议/);
    assert.equal(countShortlistedMarkdownItems(markdown), 10);
    assert.doesNotMatch(markdown, /今日 20 条候选资讯/);
    assert.deepEqual(
      brief.shortlistedItems.map((item) => item.shortlistScore),
      brief.shortlistedItems.map((item) => item.shortlistScore).sort((a, b) => b - a)
    );
    for (const [index, item] of brief.shortlistedItems.entries()) {
      assert.ok(item.id);
      assert.equal(item.rank, index + 1);
      assert.ok(item.title);
      assert.ok(item.url);
      assert.ok(item.topicAngle);
      assert.ok(item.shortlistReason);
      assert.equal(typeof item.shortlistScore, "number");
      assert.match(markdown, new RegExp(escapeRegex(item.title)));
      assert.match(markdown, new RegExp(escapeRegex(item.url)));
    }
    assert.ok(brief.recommendedTopic.url);
    assert.ok(brief.runnersUp.every((item) => item.title && item.url));
    assert.equal(await fileExists(join(outputDir, "article.md")), false);
    assert.equal(await fileExists(join(outputDir, "cover.json")), false);
    assert.equal(await fileExists(join(outputDir, "wechat-api-preflight.json")), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("editorial brief excludes shortlisted items without source URLs", async () => {
  const root = await mkdtemp(join(tmpdir(), "editorial-brief-url-filter-"));
  const outputDir = join(root, "outputs");

  try {
    const briefRun = await runBrief(outputDir);
    const candidates = briefRun.artifacts.candidates;
    const shortlisted = briefRun.artifacts.shortlisted;
    const selectedTopic = briefRun.artifacts.selectedTopic;
    assert.ok(candidates);
    assert.ok(shortlisted);
    assert.ok(selectedTopic);

    const missingUrl = {
      ...shortlisted[0],
      id: "missing-url-shortlisted",
      url: ""
    };
    const fallback = {
      ...shortlisted[0],
      id: "fallback-with-url",
      title: `${shortlisted[0].title} fallback`
    };
    const generated = await generateEditorialBrief({
      outputDir,
      candidates,
      shortlisted: [missingUrl, ...shortlisted.slice(1), fallback],
      selectedTopic,
      writeOutputs: false,
      logger: silentLogger,
      now: new Date("2026-05-29T00:00:00.000Z")
    });

    assert.equal(generated.brief.shortlistedItems.length, 10);
    assert.equal(
      generated.brief.shortlistedItems.some(
        (item) => item.id === "missing-url-shortlisted"
      ),
      false
    );
    assert.ok(generated.brief.shortlistedItems.every((item) => item.url));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("--from article blocks without editorial approval", async () => {
  const root = await mkdtemp(join(tmpdir(), "editorial-approval-missing-"));
  const outputDir = join(root, "outputs");
  const approvalFile = join(root, "inputs", "editorial-approval.json");

  try {
    await runBrief(outputDir);
    await assert.rejects(
      () =>
        runDailyPipeline({
          outputDir,
          from: "article",
          approvalFile,
          logger: silentLogger
        }),
      /Missing inputs\/editorial-approval\.json/
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("--from article blocks when approval is false or topic id is invalid", async () => {
  const root = await mkdtemp(join(tmpdir(), "editorial-approval-invalid-"));
  const outputDir = join(root, "outputs");
  const approvalFile = join(root, "inputs", "editorial-approval.json");

  try {
    await runBrief(outputDir);
    await writeApproval(approvalFile, {
      approvedByUser: false,
      approvedTopicId: ""
    });
    await assert.rejects(
      () =>
        runDailyPipeline({
          outputDir,
          from: "article",
          approvalFile,
          logger: silentLogger
        }),
      /approvedByUser is not true/
    );

    await writeApproval(approvalFile, {
      approvedByUser: true,
      approvedTopicId: "not-a-topic-id"
    });
    await assert.rejects(
      () =>
        runDailyPipeline({
          outputDir,
          from: "article",
          approvalFile,
          logger: silentLogger
        }),
      /does not match selected-topic or shortlisted-news/
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("--from article continues after approval and keeps title safety checks", async () => {
  const root = await mkdtemp(join(tmpdir(), "editorial-approval-continue-"));
  const outputDir = join(root, "outputs");
  const approvalFile = join(root, "inputs", "editorial-approval.json");

  try {
    const briefRun = await runBrief(outputDir);
    const approvedTopicId = briefRun.artifacts.selectedTopic?.selected.id;
    assert.ok(approvedTopicId);
    await writeApproval(approvalFile, {
      approvedByUser: true,
      approvedTopicId,
      approvedTitle: "震惊：Goose 免费平替 Claude Code",
      notes: "今天写这个，但角度更偏普通人和创作者影响。"
    });

    const result = await runDailyPipeline({
      outputDir,
      from: "article",
      approvalFile,
      logger: silentLogger,
      env: {
        SEARCH_ENABLE_REAL_API: "false",
        WECHAT_DRAFT_DRY_RUN: "true",
        WECHAT_API_ENABLE_REAL_DRAFT: "false",
        WECHAT_DRAFT_ALLOW_REAL_API: "false"
      },
      now: new Date("2026-05-29T00:00:00.000Z")
    });

    assert.equal(result.stoppedAt, "draft-dry-run");
    assert.equal(result.artifacts.editorialApproval?.matchedTopicKind, "selected-topic");
    assert.equal(result.artifacts.editorialApproval?.userChangedTopic, false);
    assert.equal(result.artifacts.articleMeta?.editorialApproval?.notes, "今天写这个，但角度更偏普通人和创作者影响。");
    assert.equal(result.artifacts.titleSelection?.selectedTitle.includes("震惊"), false);
    assert.ok(
      result.artifacts.titleCandidates?.some(
        (candidate) =>
          candidate.title === "震惊：Goose 免费平替 Claude Code" &&
          candidate.violations.length > 0
      )
    );
    assert.equal(result.artifacts.articleReview?.passed, true);
    assert.equal(result.artifacts.coverReview?.passed, true);
    assert.equal(result.artifacts.wechatLayout?.compatibleWithWechat, true);
    assert.equal(result.artifacts.wechatDraft?.status, "draft_saved");
    assert.equal(await fileExists(join(outputDir, "wechat-api-preflight.json")), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("--from article allows user to choose a non-recommended shortlisted topic", async () => {
  const root = await mkdtemp(join(tmpdir(), "editorial-approval-change-topic-"));
  const outputDir = join(root, "outputs");
  const approvalFile = join(root, "inputs", "editorial-approval.json");

  try {
    const briefRun = await runBrief(outputDir);
    const aiRecommendedTopicId = briefRun.artifacts.selectedTopic?.selected.id;
    const userChoice = briefRun.artifacts.shortlisted?.find(
      (item) =>
        item.id !== aiRecommendedTopicId &&
        item.url.trim().length > 0 &&
        item.shortlistMetrics.sourceCredibility >= 70
    );
    assert.ok(aiRecommendedTopicId);
    assert.ok(userChoice);

    await writeApproval(approvalFile, {
      approvedByUser: true,
      approvedTopicId: userChoice.id,
      approvedTitle: userChoice.title,
      notes: "改选这条，写作重点放在入围清单里的人工判断。"
    });

    const result = await runDailyPipeline({
      outputDir,
      from: "article",
      approvalFile,
      logger: silentLogger,
      env: {
        SEARCH_ENABLE_REAL_API: "false",
        WECHAT_DRAFT_DRY_RUN: "true",
        WECHAT_API_ENABLE_REAL_DRAFT: "false",
        WECHAT_DRAFT_ALLOW_REAL_API: "false"
      },
      now: new Date("2026-05-29T00:00:00.000Z")
    });
    const dailyReport = await readFile(join(outputDir, "daily-report.md"), "utf8");

    assert.equal(result.artifacts.selectedTopic?.selected.id, userChoice.id);
    assert.equal(result.artifacts.article?.sourceUrl, userChoice.url);
    assert.equal(result.artifacts.editorialApproval?.aiRecommendedTopicId, aiRecommendedTopicId);
    assert.equal(result.artifacts.editorialApproval?.userApprovedTopicId, userChoice.id);
    assert.equal(result.artifacts.editorialApproval?.userChangedTopic, true);
    assert.match(dailyReport, new RegExp(`aiRecommendedTopicId: ${escapeRegex(aiRecommendedTopicId)}`));
    assert.match(dailyReport, new RegExp(`userApprovedTopicId: ${escapeRegex(userChoice.id)}`));
    assert.match(dailyReport, /userChangedTopic: yes/);
    assert.match(dailyReport, /approvalNotes: 改选这条/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("--from layout blocks when dynamic artifacts are missing", async () => {
  const root = await mkdtemp(join(tmpdir(), "editorial-layout-dynamic-"));
  const outputDir = join(root, "outputs");
  const approvalFile = join(root, "inputs", "editorial-approval.json");

  try {
    const briefRun = await runBrief(outputDir);
    const approvedTopicId = briefRun.artifacts.selectedTopic?.selected.id;
    assert.ok(approvedTopicId);
    await writeApproval(approvalFile, {
      approvedByUser: true,
      approvedTopicId
    });

    await runDailyPipeline({
      outputDir,
      from: "article",
      approvalFile,
      logger: silentLogger,
      env: {
        SEARCH_ENABLE_REAL_API: "false",
        WECHAT_DRAFT_DRY_RUN: "true",
        WECHAT_API_ENABLE_REAL_DRAFT: "false",
        WECHAT_DRAFT_ALLOW_REAL_API: "false"
      },
      now: new Date("2026-05-29T00:00:00.000Z")
    });

    await rm(join(outputDir, "topic-profile.json"), { force: true });

    await assert.rejects(
      () =>
        runDailyPipeline({
          outputDir,
          from: "layout",
          approvalFile,
          logger: silentLogger,
          env: {
            SEARCH_ENABLE_REAL_API: "false",
            WECHAT_DRAFT_DRY_RUN: "true",
            WECHAT_API_ENABLE_REAL_DRAFT: "false",
            WECHAT_DRAFT_ALLOW_REAL_API: "false"
          },
          now: new Date("2026-05-29T00:00:00.000Z")
        }),
      /Missing topic-profile\.json/
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
