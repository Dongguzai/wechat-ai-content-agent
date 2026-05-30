import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  assertWechatDraftActionLabel,
  saveWechatDraftWithReport
} from "../src/pipeline/saveWechatDraft.js";
import type { ArticleMeta, ArticleReviewResult } from "../src/types/article.js";
import type { CoverResult, CoverReviewResult } from "../src/types/cover.js";
import type { WechatLayoutResult } from "../src/types/layout.js";
import type { WechatDraftResult } from "../src/types/wechatDraft.js";
import type { Logger } from "../src/utils/logger.js";

const silentLogger: Logger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined
};

interface DraftFixtureOverrides {
  articleReviewPassed?: boolean;
  coverReviewPassed?: boolean;
  wechatLayoutAllowed?: boolean;
}

function articleMetaFixture(): ArticleMeta {
  return {
    title: "AI 编码代理真正卷到的，不是价格，而是工作流",
    wordCount: 1201,
    sourceTopic: "Claude Code paid plans and Goose open-source workflow comparison.",
    articleThesis: "编码代理的主战场正在从模型能力转向工作流控制权。",
    usedClaims: [],
    riskControls: [],
    generatedAt: "2026-05-29T00:00:00.000Z"
  };
}

function articleReviewFixture(passed: boolean): ArticleReviewResult {
  return {
    passed,
    score: passed ? 100 : 60,
    summary: passed ? "文章通过审核。" : "文章未通过审核。",
    issues: [],
    requiredFixes: passed ? [] : ["修正事实边界后再进入草稿阶段。"],
    optionalSuggestions: [],
    factBoundaryCheck: {
      passed,
      violations: passed ? [] : ["fact boundary failed"]
    },
    qualityCheck: {
      wordCountOk: true,
      hasTitle: true,
      hasHeadings: true,
      thirdPersonPerspective: true,
      notNewsRelease: true,
      themesCovered: ["开源", "工作流", "成本"]
    },
    finalVerdict: passed ? "允许进入下一阶段。" : "阻止进入下一阶段。",
    generatedAt: "2026-05-29T00:00:00.000Z"
  };
}

function coverFixture(imagePath: string): CoverResult {
  return {
    provider: "apimart",
    mode: "mock",
    title: "AI 编码代理真正卷到的，不是价格，而是工作流",
    coverText: "AI 编码代理\n卷向工作流",
    imagePrompt: "Mock cover prompt.",
    negativePrompt: "No real brand marks.",
    imageSize: "900x383",
    imagePath,
    visualRequirements: {
      style: "3D animated movie quality, not specific studio imitation",
      size: "900x383",
      quality: "2K render quality",
      language: "Chinese",
      mainTextRequired: true,
      visualCenterRequired: true
    },
    review: {
      passed: true,
      issues: [],
      riskNotes: []
    },
    generatedAt: "2026-05-29T00:00:00.000Z"
  };
}

function coverReviewFixture(imagePath: string, passed: boolean): CoverReviewResult {
  return {
    provider: "apimart",
    mode: "mock",
    imageSize: "900x383",
    imagePath,
    passed,
    issues: passed ? [] : ["cover review failed"],
    riskNotes: [],
    checks: {
      providerIsApimart: true,
      coverTextIsChinese: true,
      imageSizeIs900x383: true,
      declares2KQuality: true,
      usesSafeAnimatedMovieStyle: true,
      mentionsChineseHeadline: true,
      mentionsSafeMargins: true,
      hasVisualCenter: true,
      doesNotRequestRealBrandMarks: true,
      doesNotRequestOfficialMarks: true,
      doesNotIncludeSpecificPrice: true,
      doesNotIncludeFreeSubstituteSlogan: true,
      doesNotIncludeAbsoluteSubstituteClaim: true,
      doesNotNameSpecificStudios: true,
      realApiModeProducesRealCover: true,
      realApiModeDoesNotReturnMockSvg: true,
      imagePathAvailable: true,
      embeddedReviewPassed: passed
    },
    generatedAt: "2026-05-29T00:00:00.000Z"
  };
}

function wechatLayoutFixture(
  imagePath: string,
  allowedNextStage: boolean
): WechatLayoutResult {
  return {
    title: "AI 编码代理真正卷到的，不是价格，而是工作流",
    digest: "编码代理的主战场正在从模型能力转向工作流控制权。",
    htmlPath: "outputs/wechat.html",
    coverImagePath: imagePath,
    style: "stripe-inspired",
    compatibleWithWechat: true,
    htmlChecks: {
      hasInlineStyles: true,
      hasNoExternalCss: true,
      hasNoJavascript: true,
      hasNoIframe: true,
      hasNoForbiddenPublishText: true,
      hasTitle: true,
      hasCoverImage: true,
      hasHeadings: true,
      mobileReadable: true
    },
    warnings: [],
    generatedAt: "2026-05-29T00:00:00.000Z",
    allowedNextStage
  };
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function writeDraftFixture(
  outputDir: string,
  overrides: DraftFixtureOverrides = {}
): Promise<void> {
  const articleReviewPassed = overrides.articleReviewPassed ?? true;
  const coverReviewPassed = overrides.coverReviewPassed ?? true;
  const wechatLayoutAllowed = overrides.wechatLayoutAllowed ?? true;
  const coverDir = join(outputDir, "covers");
  const coverPath = join(coverDir, "cover.svg");

  await mkdir(coverDir, { recursive: true });
  await writeFile(
    join(outputDir, "article.md"),
    [
      "AI 编码代理真正卷到的，不是价格，而是工作流",
      "",
      "## 趋势判断",
      "",
      "编码代理竞争正在转向工作流控制权。"
    ].join("\n"),
    "utf8"
  );
  await writeJson(join(outputDir, "article-meta.json"), articleMetaFixture());
  await writeJson(
    join(outputDir, "article-review.json"),
    articleReviewFixture(articleReviewPassed)
  );
  await writeFile(coverPath, "<svg />\n", "utf8");
  await writeJson(join(outputDir, "cover.json"), coverFixture(coverPath));
  await writeJson(
    join(outputDir, "cover-review.json"),
    coverReviewFixture(coverPath, coverReviewPassed)
  );
  await writeFile(
    join(outputDir, "wechat.html"),
    '<section style="font-size:16px;line-height:1.78;"><h1>AI 编码代理真正卷到的，不是价格，而是工作流</h1><h2>趋势判断</h2><p>正文 HTML。</p></section>',
    "utf8"
  );
  await writeJson(
    join(outputDir, "wechat-layout.json"),
    wechatLayoutFixture(coverPath, wechatLayoutAllowed)
  );
  await writeFile(join(outputDir, "wechat-layout-report.md"), "layout ok\n", "utf8");
}

test("saveWechatDraftWithReport writes mock draft result and report", async () => {
  const outputDir = await mkdtemp(join(tmpdir(), "wechat-draft-publisher-"));

  try {
    await writeDraftFixture(outputDir);

    const result = await saveWechatDraftWithReport({
      outputDir,
      logger: silentLogger,
      now: new Date("2026-05-29T00:00:00.000Z")
    });

    await access(join(outputDir, "wechat-draft-result.json"));
    await access(join(outputDir, "wechat-draft-report.md"));

    const saved = JSON.parse(
      await readFile(result.files.wechatDraftResult, "utf8")
    ) as WechatDraftResult;
    const report = await readFile(result.files.wechatDraftReport, "utf8");

    assert.equal(saved.mode, "mock");
    assert.equal(saved.status, "draft_saved");
    assert.ok(saved.draftId);
    assert.ok(saved.previewUrl);
    assert.equal(saved.allowedNextStage, false);
    assert.equal(saved.safety.autoPublishBlocked, true);
    assert.equal(saved.safety.onlyDraftSaved, true);
    assert.equal(saved.safety.requiresHumanConfirmation, true);
    assert.equal(saved.htmlPath, "outputs/wechat.html");
    assert.match(report, /草稿箱写入 dry-run 结论/);
    assert.match(report, /mock draftId/);
    assert.match(report, /mock previewUrl/);
    assert.match(report, /系统不会自动发布，也不会自动群发/);
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});

test("wechat draft action labels allow draft save and preview", () => {
  assert.doesNotThrow(() => assertWechatDraftActionLabel("保存草稿"));
  assert.doesNotThrow(() => assertWechatDraftActionLabel("生成预览"));
});

test("wechat draft action labels block publish and send operations", () => {
  for (const label of ["发布", "群发", "确认发送", "立即发送"]) {
    assert.throws(
      () => assertWechatDraftActionLabel(`模拟${label}`),
      /Forbidden outbound operation term detected/
    );
  }
});

test("saveWechatDraftWithReport blocks when article review failed", async () => {
  const outputDir = await mkdtemp(join(tmpdir(), "wechat-draft-article-blocked-"));

  try {
    await writeDraftFixture(outputDir, { articleReviewPassed: false });

    await assert.rejects(
      () => saveWechatDraftWithReport({ outputDir, logger: silentLogger }),
      /Article review has not passed/
    );
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});

test("saveWechatDraftWithReport blocks when cover review failed", async () => {
  const outputDir = await mkdtemp(join(tmpdir(), "wechat-draft-cover-blocked-"));

  try {
    await writeDraftFixture(outputDir, { coverReviewPassed: false });

    await assert.rejects(
      () => saveWechatDraftWithReport({ outputDir, logger: silentLogger }),
      /Cover review has not passed/
    );
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});

test("saveWechatDraftWithReport blocks when layout disallows next stage", async () => {
  const outputDir = await mkdtemp(join(tmpdir(), "wechat-draft-layout-blocked-"));

  try {
    await writeDraftFixture(outputDir, { wechatLayoutAllowed: false });

    await assert.rejects(
      () => saveWechatDraftWithReport({ outputDir, logger: silentLogger }),
      /WeChat layout did not allow the draft stage/
    );
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});
