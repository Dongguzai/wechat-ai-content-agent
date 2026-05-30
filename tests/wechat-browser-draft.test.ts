import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { reviewWechatBrowserActionLabel } from "../src/adapters/wechatBrowser.js";
import { saveWechatDraftBrowserPlanWithReport } from "../src/pipeline/saveWechatDraftBrowser.js";
import type { ArticleReviewResult } from "../src/types/article.js";
import type { CoverResult, CoverReviewResult } from "../src/types/cover.js";
import type { WechatLayoutResult } from "../src/types/layout.js";
import type { WechatDraftResult } from "../src/types/wechatDraft.js";
import type {
  WechatBrowserDraftPlan,
  WechatBrowserSafetyCheck
} from "../src/types/wechatBrowser.js";
import type { Logger } from "../src/utils/logger.js";

const silentLogger: Logger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined
};

function articleReviewFixture(): ArticleReviewResult {
  return {
    passed: true,
    score: 100,
    summary: "文章通过审核。",
    issues: [],
    requiredFixes: [],
    optionalSuggestions: [],
    factBoundaryCheck: {
      passed: true,
      violations: []
    },
    qualityCheck: {
      wordCountOk: true,
      hasTitle: true,
      hasHeadings: true,
      thirdPersonPerspective: true,
      notNewsRelease: true,
      themesCovered: ["开源", "工作流", "成本"]
    },
    finalVerdict: "允许进入下一阶段。",
    generatedAt: "2026-05-29T00:00:00.000Z"
  };
}

function coverFixture(imagePath: string): CoverResult {
  return {
    provider: "apimart",
    mode: "mock",
    title: "这条 AI 新闻背后，是一次工作流重排",
    coverText: "AI 工作流",
    imagePrompt: "Mock cover prompt.",
    negativePrompt: "No brand marks.",
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

function coverReviewFixture(imagePath: string): CoverReviewResult {
  return {
    provider: "apimart",
    mode: "mock",
    imageSize: "900x383",
    imagePath,
    passed: true,
    issues: [],
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
      embeddedReviewPassed: true
    },
    generatedAt: "2026-05-29T00:00:00.000Z"
  };
}

function wechatLayoutFixture(imagePath: string): WechatLayoutResult {
  return {
    title: "这条 AI 新闻背后，是一次工作流重排",
    digest: "编码代理竞争正在转向工作流控制权。",
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
    allowedNextStage: true
  };
}

function wechatDraftResultFixture(imagePath: string): WechatDraftResult {
  return {
    mode: "mock",
    status: "draft_saved",
    title: "这条 AI 新闻背后，是一次工作流重排",
    draftId: "mock-draft-20260529000000000",
    previewUrl: "mock://wechat-draft/mock-draft-20260529000000000/preview",
    htmlPath: "outputs/wechat.html",
    coverImagePath: imagePath,
    actions: [
      {
        label: "保存草稿",
        status: "passed"
      },
      {
        label: "生成预览",
        status: "passed"
      }
    ],
    safety: {
      autoPublishBlocked: true,
      onlyDraftSaved: true,
      requiresHumanConfirmation: true,
      forbiddenActionsChecked: ["群发", "发布", "确认发送", "立即发送"]
    },
    allowedNextStage: false,
    humanActionRequired:
      "请人工登录微信公众号后台检查草稿预览，确认无误后再手动发布。",
    generatedAt: "2026-05-29T00:00:00.000Z"
  };
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function writeBrowserPlanFixture(input: {
  outputDir: string;
  docsDir: string;
}): Promise<void> {
  const coverDir = join(input.outputDir, "covers");
  const coverPath = join(coverDir, "cover.svg");

  await mkdir(coverDir, { recursive: true });
  await mkdir(input.docsDir, { recursive: true });
  await writeJson(join(input.outputDir, "article-review.json"), articleReviewFixture());
  await writeFile(coverPath, "<svg />\n", "utf8");
  await writeJson(join(input.outputDir, "cover.json"), coverFixture(coverPath));
  await writeJson(
    join(input.outputDir, "cover-review.json"),
    coverReviewFixture(coverPath)
  );
  await writeFile(
    join(input.outputDir, "wechat.html"),
    '<section style="font-size:16px;"><h1>这条 AI 新闻背后，是一次工作流重排</h1><p>正文。</p></section>',
    "utf8"
  );
  await writeJson(
    join(input.outputDir, "wechat-layout.json"),
    wechatLayoutFixture(coverPath)
  );
  await writeJson(
    join(input.outputDir, "wechat-draft-result.json"),
    wechatDraftResultFixture(coverPath)
  );
  await writeFile(
    join(input.docsDir, "wechat-draft-browser-sop.md"),
    "SOP\n",
    "utf8"
  );
  await writeFile(
    join(input.docsDir, "wechat-draft-browser-checklist.md"),
    "Checklist\n",
    "utf8"
  );
  await writeFile(
    join(input.docsDir, "wechat-draft-risk-map.md"),
    "Risk map\n",
    "utf8"
  );
}

function findStep(plan: WechatBrowserDraftPlan, id: string) {
  const step = plan.steps.find((candidate) => candidate.id === id);
  assert.ok(step, `missing step ${id}`);
  return step;
}

test("browser-disabled mode writes browser draft plan outputs without enabling real browser", async () => {
  const outputDir = await mkdtemp(join(tmpdir(), "wechat-browser-plan-"));
  const docsDir = await mkdtemp(join(tmpdir(), "wechat-browser-docs-"));

  try {
    await writeBrowserPlanFixture({ outputDir, docsDir });

    const result = await saveWechatDraftBrowserPlanWithReport({
      outputDir,
      docsDir,
      logger: silentLogger,
      env: {
        WECHAT_BROWSER_ENABLE_REAL: "false",
        WECHAT_BROWSER_ALLOW_SAVE_DRAFT: "false",
        WECHAT_BROWSER_ALLOW_PREVIEW: "false"
      },
      now: new Date("2026-05-29T00:00:00.000Z")
    });

    await access(join(outputDir, "wechat-browser-draft-plan.json"));
    await access(join(outputDir, "wechat-browser-draft-plan.md"));
    await access(join(outputDir, "wechat-browser-safety-check.json"));

    const savedPlan = JSON.parse(
      await readFile(result.files.wechatBrowserDraftPlan, "utf8")
    ) as WechatBrowserDraftPlan;
    const savedSafety = JSON.parse(
      await readFile(result.files.wechatBrowserSafetyCheck, "utf8")
    ) as WechatBrowserSafetyCheck;

    assert.equal(savedPlan.mode, "browser-disabled");
    assert.equal(savedPlan.browserDisabled, true);
    assert.equal(savedPlan.realBrowserEnabled, false);
    assert.equal(savedSafety.realBrowserEnabled, false);
    assert.equal(savedSafety.passed, true);
    assert.equal(savedSafety.credentialsStored, false);
    assert.equal(savedSafety.cookieTokenCommitted, false);

    const loginStep = findStep(savedPlan, "wait-human-scan-login");
    assert.equal(loginStep.label, "等待人工扫码登录");
    assert.equal(loginStep.requiresHumanAction, true);
  } finally {
    await rm(outputDir, { recursive: true, force: true });
    await rm(docsDir, { recursive: true, force: true });
  }
});

test("save draft and preview steps are controlled by explicit env switches", async () => {
  const outputDir = await mkdtemp(join(tmpdir(), "wechat-browser-controls-"));
  const docsDir = await mkdtemp(join(tmpdir(), "wechat-browser-controls-docs-"));

  try {
    await writeBrowserPlanFixture({ outputDir, docsDir });

    const blocked = await saveWechatDraftBrowserPlanWithReport({
      outputDir,
      docsDir,
      logger: silentLogger,
      writeOutputs: false,
      env: {
        WECHAT_BROWSER_ENABLE_REAL: "true",
        WECHAT_BROWSER_ALLOW_SAVE_DRAFT: "false",
        WECHAT_BROWSER_ALLOW_PREVIEW: "false"
      },
      now: new Date("2026-05-29T00:00:00.000Z")
    });
    assert.equal(findStep(blocked.plan, "save-draft").allowed, false);
    assert.equal(findStep(blocked.plan, "generate-preview").allowed, false);

    const allowed = await saveWechatDraftBrowserPlanWithReport({
      outputDir,
      docsDir,
      logger: silentLogger,
      writeOutputs: false,
      env: {
        WECHAT_BROWSER_ENABLE_REAL: "true",
        WECHAT_BROWSER_ALLOW_SAVE_DRAFT: "true",
        WECHAT_BROWSER_ALLOW_PREVIEW: "true"
      },
      now: new Date("2026-05-29T00:00:00.000Z")
    });
    assert.equal(allowed.plan.mode, "browser-real");
    assert.equal(findStep(allowed.plan, "save-draft").allowed, true);
    assert.equal(findStep(allowed.plan, "generate-preview").allowed, true);
  } finally {
    await rm(outputDir, { recursive: true, force: true });
    await rm(docsDir, { recursive: true, force: true });
  }
});

test("browser plan keeps publish and mass-send labels out of executable steps", async () => {
  const outputDir = await mkdtemp(join(tmpdir(), "wechat-browser-forbidden-"));
  const docsDir = await mkdtemp(join(tmpdir(), "wechat-browser-forbidden-docs-"));
  const forbiddenTerms = ["发布", "群发", "确认发送", "立即发送"];

  try {
    await writeBrowserPlanFixture({ outputDir, docsDir });

    const result = await saveWechatDraftBrowserPlanWithReport({
      outputDir,
      docsDir,
      logger: silentLogger,
      writeOutputs: false,
      env: {
        WECHAT_BROWSER_ENABLE_REAL: "false"
      },
      now: new Date("2026-05-29T00:00:00.000Z")
    });

    for (const term of forbiddenTerms) {
      assert.ok(result.plan.forbiddenActions.includes(term));
      assert.equal(
        result.plan.steps.some((step) => step.label.includes(term)),
        false,
        `step label should not contain ${term}`
      );
    }
  } finally {
    await rm(outputDir, { recursive: true, force: true });
    await rm(docsDir, { recursive: true, force: true });
  }
});

test("browser action label review blocks publish and mass-send actions", () => {
  assert.equal(reviewWechatBrowserActionLabel("点击发布").safetyCheck, "blocked");
  assert.equal(reviewWechatBrowserActionLabel("点击群发").safetyCheck, "blocked");
  assert.equal(
    reviewWechatBrowserActionLabel("点击确认发送").safetyCheck,
    "blocked"
  );
  assert.equal(
    reviewWechatBrowserActionLabel("点击立即发送").safetyCheck,
    "blocked"
  );
});
