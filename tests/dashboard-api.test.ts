import { access, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { tmpdir } from "node:os";
import assert from "node:assert/strict";
import test from "node:test";
import { executeDashboardAction } from "../apps/dashboard/lib/actions";
import { getBriefData, getDashboardStatus, getSettingsStatus, readFileForApi } from "../apps/dashboard/lib/dashboard-data";
import {
  createCurrentFeedback,
  cropCover,
  deleteCoverVersion,
  regenerateCover,
  saveArticleDraft,
  selectArticleTitle,
  selectBriefTopic,
  setCurrentCoverVersion
} from "../apps/dashboard/lib/editor-workflow";
import { saveApproval, saveFeedback } from "../apps/dashboard/lib/forms";

const dashboardRequire = createRequire(new URL("../apps/dashboard/package.json", import.meta.url));
const sharp = dashboardRequire("sharp") as any;

async function createTempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "dashboard-api-"));
  await mkdir(join(root, "outputs"), { recursive: true });
  await mkdir(join(root, "inputs"), { recursive: true });
  await mkdir(join(root, "feedback"), { recursive: true });
  await mkdir(join(root, "runs"), { recursive: true });
  await mkdir(join(root, "docs"), { recursive: true });
  await writeFile(join(root, "package.json"), JSON.stringify({ name: "wechat-ai-content-agent" }));
  await mkdir(join(root, "src"), { recursive: true });
  await mkdir(join(root, "scripts"), { recursive: true });
  return root;
}

async function writeJson(root: string, relativePath: string, value: unknown): Promise<void> {
  await writeFile(join(root, relativePath), JSON.stringify(value, null, 2), "utf8");
}

const tinyPngBase64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

function apimartEnv(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    COVER_IMAGE_PROVIDER: "apimart",
    COVER_ENABLE_REAL_API: "true",
    APIMART_API_KEY: "apimart-secret-value",
    APIMART_IMAGE_API_URL: "https://apimart.example/v1/images/generations",
    APIMART_TASK_INITIAL_DELAY_MS: "0",
    APIMART_TASK_POLL_INTERVAL_MS: "0",
    APIMART_COVER_STYLE: "Pixar-inspired clean cover",
    ...overrides
  };
}

async function seedCoverRegenerateFiles(root: string): Promise<string> {
  await mkdir(join(root, "outputs/covers"), { recursive: true });
  const currentCoverPath = join(root, "outputs/covers/current.png");
  await writeFile(currentCoverPath, Buffer.from(tinyPngBase64, "base64"));
  await writeJson(root, "outputs/article-meta.json", {
    title: "当前文章标题",
    articleThesis: "核心观点是 AI 编码代理竞争正在转向工作流入口。"
  });
  await writeFile(join(root, "outputs/article.md"), "# 当前文章标题\n\n正文内容。", "utf8");
  await writeJson(root, "outputs/cover.json", {
    provider: "apimart",
    mode: "real",
    title: "当前文章标题",
    coverText: "AI 工作流\n入口之争",
    imagePrompt: "Current prompt with $200 and 免费平替 should be sanitized.",
    negativePrompt: "low resolution",
    imageSize: "900x383",
    imagePath: currentCoverPath,
    generatedAt: "2026-06-01T00:00:00.000Z",
    review: { passed: true, issues: [], riskNotes: [] }
  });
  return currentCoverPath;
}

function fakeApimartFetch(calls: string[] = []): typeof fetch {
  return (async (url: string | URL | Request) => {
    calls.push(String(url));
    return new Response(
      JSON.stringify({
        data: [{ b64_json: tinyPngBase64 }]
      }),
      {
        status: 200,
        headers: { "content-type": "application/json" }
      }
    );
  }) as typeof fetch;
}

test("dashboard status reads outputs state", async () => {
  const root = await createTempRoot();
  try {
    await writeJson(root, "outputs/candidate-news.json", [{ title: "候选" }]);
    await writeJson(root, "outputs/shortlisted-news.json", [{ title: "入围" }]);
    await writeJson(root, "outputs/selected-topic.json", { selected: { title: "主选题" } });
    await writeJson(root, "outputs/article-meta.json", { title: "文章标题" });
    await writeJson(root, "outputs/article-review.json", { passed: true });
    await writeJson(root, "outputs/cover-review.json", { passed: true });
    await writeJson(root, "outputs/wechat-layout.json", { allowedNextStage: true, compatibleWithWechat: true });
    await writeJson(root, "outputs/wechat-api-preflight.json", { passed: true });
    await writeJson(root, "outputs/wechat-draft-result.json", { status: "draft_saved", mode: "mock" });

    const status = await getDashboardStatus({ rootDir: root });

    assert.equal(status.briefSource, "pipeline-outputs");
    assert.equal(status.steps.find((step) => step.key === "article-review")?.state, "passed");
    assert.equal(status.steps.find((step) => step.key === "wechat-draft")?.state, "passed");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("file API helper refuses .env and node_modules", async () => {
  const root = await createTempRoot();
  try {
    await writeFile(join(root, ".env"), "WECHAT_APP_SECRET=secret", "utf8");
    await mkdir(join(root, "node_modules"), { recursive: true });
    await writeFile(join(root, "node_modules/secret.txt"), "secret", "utf8");
    await writeFile(join(root, "outputs/ok.txt"), "hello", "utf8");

    await assert.rejects(() => readFileForApi(".env", { rootDir: root }));
    await assert.rejects(() => readFileForApi("node_modules/secret.txt", { rootDir: root }));
    const ok = await readFileForApi("outputs/ok.txt", { rootDir: root });
    assert.equal(ok.content, "hello");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("dashboard action only executes allowlisted commands", async () => {
  const root = await createTempRoot();
  try {
    const result = await executeDashboardAction("draftDryRun", {
      rootDir: root,
      runner: async (input) => {
        assert.equal(input.command, "pnpm");
        assert.deepEqual(input.args, ["wechat:draft:dry-run"]);
        return {
          exitCode: 0,
          stdout: "access_token=should-not-leak\nok",
          stderr: ""
        };
      }
    });

    assert.equal(result.status, "passed");
    assert.match(result.stdout, /\[REDACTED\]/);
    assert.doesNotMatch(result.stdout, /should-not-leak/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("dashboard action refreshLayout is allowlisted and fixed to layout flow", async () => {
  const root = await createTempRoot();
  try {
    const result = await executeDashboardAction("refreshLayout", {
      rootDir: root,
      runner: async (input) => {
        assert.equal(input.command, "pnpm");
        assert.deepEqual(input.args, ["run:daily", "--", "--from", "layout"]);
        assert.equal(input.env.FORBID_WECHAT_PUBLISH, "true");
        assert.equal(input.env.FORBID_WECHAT_MASS_SEND, "true");
        return { exitCode: 0, stdout: "ok", stderr: "" };
      }
    });

    assert.equal(result.status, "passed");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("dashboard action rejects publish, freepublish, mass, and sendall", async () => {
  const root = await createTempRoot();
  try {
    for (const action of ["publish", "freepublish", "mass", "sendall", "群发", "立即发送"]) {
      const result = await executeDashboardAction(action, {
        rootDir: root,
        runner: async () => {
          throw new Error("runner should not be called");
        }
      });
      assert.equal(result.status, "rejected");
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("approval writer saves inputs/editorial-approval.json", async () => {
  const root = await createTempRoot();
  try {
    const result = await saveApproval(
      {
        approvedByUser: true,
        approvedTopicId: "topic-1",
        approvedTitle: "标题",
        notes: "ok"
      },
      { rootDir: root }
    );
    const saved = JSON.parse(await readFile(join(root, result.path), "utf8"));
    assert.equal(saved.approvedByUser, true);
    assert.equal(saved.approvedTopicId, "topic-1");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("dashboard brief data prioritizes 10 shortlisted items with source URLs", async () => {
  const root = await createTempRoot();
  try {
    const shortlistedItems = Array.from({ length: 10 }, (_, index) => ({
      id: `topic-${index + 1}`,
      rank: index + 1,
      title: `入围资讯 ${index + 1}`,
      url: `https://example.com/original-${index + 1}`,
      sourceName: "Example",
      sourceType: index === 0 ? "global_search" : "rss",
      provider: index === 0 ? "tavily" : null,
      query: index === 0 ? "AI news" : null,
      category: "tooling",
      tags: ["agent"],
      summary: "摘要",
      topicAngle: "选题角度",
      shortlistReason: "入围理由",
      shortlistScore: 90 - index,
      riskNotes: []
    }));
    await writeJson(root, "outputs/editorial-brief.json", {
      generatedAt: "2026-06-02T00:00:00.000Z",
      shortlistedItems,
      recommendedTopic: {
        id: "topic-1",
        title: "推荐",
        url: "https://example.com/original-1",
        riskNotes: []
      },
      runnersUp: shortlistedItems.slice(1, 3),
      approvalRequired: true
    });

    const data = await getBriefData({ rootDir: root });

    assert.equal(data.shortlisted.length, 10);
    assert.ok(data.shortlisted.every((item) => item.title && item.url));
    assert.equal(data.shortlisted[0].sourceType, "global_search");
    assert.equal(data.shortlisted[0].provider, "tavily");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("brief topic selection writes approved editorial approval and redirects to article", async () => {
  const root = await createTempRoot();
  try {
    const shortlistedItems = Array.from({ length: 10 }, (_, index) => ({
      id: `topic-${index + 1}`,
      title: `入围资讯 ${index + 1}`,
      url: `https://example.com/${index + 1}`
    }));
    await writeJson(root, "outputs/editorial-brief.json", { shortlistedItems });

    // 模拟 client 端发完整 topic 对象（cloud flow 真实场景）
    const result = await selectBriefTopic(
      {
        topicId: "topic-7",
        topic: {
          id: "topic-7",
          title: "入围资讯 7",
          titleZh: "入围资讯 7",
          url: "https://example.com/7"
        }
      },
      { rootDir: root }
    );
    const saved = JSON.parse(await readFile(join(root, "inputs/editorial-approval.json"), "utf8"));

    assert.equal(result.redirectTo, "/article");
    assert.equal(saved.approvedByUser, true);
    assert.equal(saved.approvedTopicId, "topic-7");
    assert.equal(saved.approvedTitle, "入围资讯 7");
    assert.equal(saved.notes, "");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("brief topic selection accepts a cloud brief topic snapshot", async () => {
  const root = await createTempRoot();
  try {
    const result = await selectBriefTopic(
      {
        topicId: "cloud-topic-3",
        topic: {
          id: "cloud-topic-3",
          title: "Cloud topic raw title",
          titleZh: "云端入围资讯",
          url: "https://example.com/cloud-topic-3"
        }
      },
      { rootDir: root }
    );
    const saved = JSON.parse(await readFile(join(root, "inputs/editorial-approval.json"), "utf8"));

    assert.equal(result.redirectTo, "/article");
    assert.equal(saved.approvedByUser, true);
    assert.equal(saved.approvedTopicId, "cloud-topic-3");
    assert.equal(saved.approvedTitle, "云端入围资讯");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("brief topic selection rejects shortlisted items without URL", async () => {
  const root = await createTempRoot();
  try {
    await writeJson(root, "outputs/editorial-brief.json", {
      shortlistedItems: [{ id: "topic-1", title: "无 URL" }]
    });

    await assert.rejects(
      () => selectBriefTopic({ topicId: "topic-1" }, { rootDir: root }),
      /original URL/
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("article save writes markdown and updates meta word count", async () => {
  const root = await createTempRoot();
  try {
    const result = await saveArticleDraft(
      { title: "新标题", content: "第一段\n\n第二段" },
      { rootDir: root }
    );
    const markdown = await readFile(join(root, "outputs/article.md"), "utf8");
    const meta = JSON.parse(await readFile(join(root, "outputs/article-meta.json"), "utf8"));

    assert.equal(result.articlePath, "outputs/article.md");
    assert.match(markdown, /^# 新标题/);
    assert.equal(meta.title, "新标题");
    assert.equal(typeof meta.wordCount, "number");
    assert.equal(typeof meta.updatedAt, "string");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("article title selection must come from candidates and blocks forbidden terms", async () => {
  const root = await createTempRoot();
  try {
    await writeJson(root, "outputs/title-candidates.json", {
      forbiddenTerms: ["群发"],
      candidates: [
        { title: "安全标题", violations: [] },
        { title: "群发标题", violations: [] }
      ]
    });
    await writeJson(root, "outputs/article-meta.json", { title: "旧标题" });
    await writeFile(join(root, "outputs/article.md"), "# 旧标题\n\n正文", "utf8");

    const result = await selectArticleTitle({ title: "安全标题" }, { rootDir: root });
    const markdown = await readFile(join(root, "outputs/article.md"), "utf8");

    assert.equal(result.title, "安全标题");
    assert.match(markdown, /^# 安全标题/);
    await assert.rejects(
      () => selectArticleTitle({ title: "群发标题" }, { rootDir: root }),
      /forbidden term/
    );
    await assert.rejects(
      () => selectArticleTitle({ title: "不存在" }, { rootDir: root }),
      /title-candidates/
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("/brief page reads the cloud today API with friendly empty state", async () => {
  const pageSource = await readFile(
    join(process.cwd(), "apps/dashboard/app/brief/page.tsx"),
    "utf8"
  );
  const viewSource = await readFile(
    join(process.cwd(), "apps/dashboard/components/cloud-brief-view.tsx"),
    "utf8"
  );

  assert.match(pageSource, /CloudBriefView/);
  assert.match(pageSource, /requireDashboardSession/);
  assert.match(viewSource, /api\/brief\/today/);
  assert.match(viewSource, /今日 10 条入围资讯阅读清单/);
  assert.match(viewSource, /今日简报尚未生成。请等待 7 点定时任务，或手动触发生成。/);
  assert.match(viewSource, /href=\{item\.url\}/);
  assert.match(viewSource, /api\/brief\/select-topic/);
  assert.match(viewSource, /选择此题/);
});

test("/brief page can manually generate and refresh today's cloud brief", async () => {
  const viewSource = await readFile(
    join(process.cwd(), "apps/dashboard/components/cloud-brief-view.tsx"),
    "utf8"
  );

  assert.match(viewSource, /开始收集/);
  assert.match(viewSource, /重新收集/);
  assert.match(viewSource, /api\/brief\/generate/);
  assert.match(viewSource, /method: "POST"/);
  assert.match(viewSource, /JSON\.stringify\(force \? \{ force: true \} : \{\}\)/);
  assert.match(viewSource, /disabled=\{generateState === "loading"\}/);
  assert.match(viewSource, /正在收集\.\.\./);
  assert.match(viewSource, /正在抓取资讯并筛选 10 条入围内容，通常需要 30～60 秒。/);
  assert.match(viewSource, /收集完成/);
  assert.match(viewSource, /await loadBrief\(\{ showLoading: false \}\)/);
  assert.match(viewSource, /items\.slice\(0, 10\)\.map/);
});

test("/brief rerun asks for confirmation and displays step-level failures", async () => {
  const viewSource = await readFile(
    join(process.cwd(), "apps/dashboard/components/cloud-brief-view.tsx"),
    "utf8"
  );

  assert.match(viewSource, /window\.confirm/);
  assert.match(viewSource, /今天已经生成过简报，重新收集会覆盖今日入围资讯，是否继续？/);
  assert.match(viewSource, /收集失败/);
  assert.match(viewSource, /失败阶段：/);
  assert.match(viewSource, /错误摘要：/);
  assert.match(viewSource, /排查提示：/);
  assert.match(viewSource, /Endpoint：/);
  assert.match(viewSource, /result\.step \?\? "unknown"/);
  assert.match(viewSource, /result\.error \?\? "Brief generation failed\."/);
});

test("/api/brief/generate is dashboard-authenticated and not a cron-secret endpoint", async () => {
  const routeSource = await readFile(
    join(process.cwd(), "apps/dashboard/app/api/brief/generate/route.ts"),
    "utf8"
  );
  const handlerSource = await readFile(
    join(process.cwd(), "apps/dashboard/lib/manual-generate-brief.ts"),
    "utf8"
  );
  const viewSource = await readFile(
    join(process.cwd(), "apps/dashboard/components/cloud-brief-view.tsx"),
    "utf8"
  );
  const source = `${routeSource}\n${handlerSource}`;

  assert.match(source, /hasDashboardSession/);
  assert.match(source, /generateCloudBriefForToday/);
  assert.match(source, /manual force run/);
  assert.match(source, /step/);
  assert.match(source, /redactJson/);
  assert.doesNotMatch(source, /verifyBearerToken/);
  assert.doesNotMatch(viewSource, /CRON_SECRET|DATABASE_URL|R2_SECRET_ACCESS_KEY|API_KEY|APP_SECRET|ACCESS_TOKEN/);
  assert.doesNotMatch(source, /wechatOfficialApi|saveWechatDraft|freepublish|mass|sendall|api\.weixin\.qq\.com|\/publish/i);
});

test("dashboard next config loads root .env for server-only auth settings", async () => {
  const source = await readFile(
    join(process.cwd(), "apps/dashboard/next.config.ts"),
    "utf8"
  );

  assert.match(source, /loadRootDotEnv\(\)/);
  assert.match(source, /join\(dashboardDir, "\.\.", "\.\.", "\.env"\)/);
  assert.match(source, /process\.env\[key\] !== undefined/);
  assert.doesNotMatch(source, /console\.log|DASHBOARD_PASSWORD|AUTH_SECRET/);
});

test("dashboard main nav only exposes brief, article, preview, and feedback", async () => {
  const shellSource = await readFile(
    join(process.cwd(), "apps/dashboard/components/shell.tsx"),
    "utf8"
  );
  const navBlock = shellSource.match(/const navItems = \[[\s\S]*?\];/)?.[0] ?? "";
  const debugBlock = shellSource.match(/const debugItems = \[[\s\S]*?\];/)?.[0] ?? "";

  for (const label of ["简报", "文章", "预览", "反馈"]) {
    assert.match(navBlock, new RegExp(label));
  }
  for (const label of ["总览", "确认", "标题", "封面", "微信", "Runs", "设置"]) {
    assert.doesNotMatch(navBlock, new RegExp(label));
    assert.match(debugBlock, new RegExp(label));
  }
});

test("article workbench has collapsed title candidates, editable article, AI rewrite, and cover controls", async () => {
  const source = await readFile(
    join(process.cwd(), "apps/dashboard/components/article-workbench.tsx"),
    "utf8"
  );

  assert.match(source, /useState\(false\)/);
  assert.match(source, /展开标题候选/);
  assert.match(source, /api\/article\/select-title/);
  assert.match(source, /api\/article\/save/);
  assert.match(source, /api\/article\/rewrite/);
  assert.match(source, /api\/article\/confirm/);
  assert.match(source, /api\/cover\/crop/);
  assert.match(source, /api\/cover\/regenerate/);
  assert.match(source, /保存草稿/);
  assert.match(source, /预览排版/);
  assert.match(source, /确认下一步/);
});

test("article workbench cover regenerate keeps loading on the button and refreshes cover files", async () => {
  const source = await readFile(
    join(process.cwd(), "apps/dashboard/components/article-workbench.tsx"),
    "utf8"
  );

  assert.match(source, /CoverRegenerateStatus = "idle" \| "loading" \| "success" \| "failed"/);
  assert.match(source, /coverRegenerateInFlight/);
  assert.match(source, /正在生成\.\.\./);
  assert.match(source, /disabled=\{pending \|\| coverRegenerating\}/);
  assert.doesNotMatch(source, /正在调用 APIMart 生成新封面，可能需要几十秒/);
  assert.match(source, /封面已重新生成/);
  assert.match(source, /封面生成失败/);
  assert.match(source, /fetchDashboardJson\("outputs\/cover\.json"\)/);
  assert.match(source, /fetchDashboardJson\("outputs\/cover-history\.json"\)/);
  assert.match(source, /raw=1&t=/);
  assert.match(source, /setCoverPrompt\(""\)/);
  assert.match(source, /已设为当前封面/);
  assert.match(source, /window\.confirm/);
  assert.match(source, /当前封面不能删除/);
});

test("article workbench renders an interactive fixed-ratio cover cropper", async () => {
  const source = await readFile(
    join(process.cwd(), "apps/dashboard/components/article-workbench.tsx"),
    "utf8"
  );

  assert.match(source, /from "react-easy-crop"/);
  assert.match(source, /const WECHAT_COVER_ASPECT = 900 \/ 383/);
  assert.match(source, /const \[crop, setCrop\] = useState\(\{ x: 0, y: 0 \}\)/);
  assert.match(source, /const \[zoom, setZoom\] = useState\(1\)/);
  assert.match(source, /const \[croppedAreaPixels, setCroppedAreaPixels\]/);
  assert.match(source, /<Cropper/);
  assert.match(source, /image=\{coverImage\.src\}/);
  assert.match(source, /crop=\{crop\}/);
  assert.match(source, /zoom=\{zoom\}/);
  assert.match(source, /aspect=\{WECHAT_COVER_ASPECT\}/);
  assert.match(source, /onCropChange=\{setCrop\}/);
  assert.match(source, /onZoomChange=\{setZoom\}/);
  assert.match(source, /onCropComplete=\{onCropComplete\}/);
  assert.match(source, /type="range"/);
  assert.match(source, /setZoom\(Number\(event\.target\.value\)\)/);
  assert.match(source, /\/api\/cover\/crop/);
  assert.match(source, /x: croppedAreaPixels\.x/);
  assert.match(source, /width: croppedAreaPixels\.width/);
  assert.match(source, /rawFileUrl\(nextRelativePath, Date\.now\(\)\)/);
  assert.match(source, /setCoverHistory\(normalizeHistoryItems\(payload\.history, nextRelativePath\)\)/);
  assert.match(source, /封面裁剪已保存并应用到当前文章/);
  assert.match(source, /封面裁剪失败/);
  assert.doesNotMatch(source, /CropField/);
});

test("cover regenerate route returns ok true payload and redacted failed payload", async () => {
  const source = await readFile(
    join(process.cwd(), "apps/dashboard/app/api/cover/regenerate/route.ts"),
    "utf8"
  );

  assert.match(source, /regenerateCover\(body\)/);
  assert.match(source, /\{ ok: true, \.\.\.result \}/);
  assert.match(source, /ok: false/);
  assert.match(source, /redactJson/);
});

test("only preview page exposes the write-to-draft action button", async () => {
  const previewSource = await readFile(
    join(process.cwd(), "apps/dashboard/app/preview/page.tsx"),
    "utf8"
  );
  const appFiles = [
    "apps/dashboard/app/page.tsx",
    "apps/dashboard/app/brief/page.tsx",
    "apps/dashboard/app/article/page.tsx",
    "apps/dashboard/app/feedback/page.tsx",
    "apps/dashboard/app/wechat/page.tsx"
  ];

  assert.match(previewSource, /createWechatDraft/);
  assert.match(previewSource, /写入公众号草稿箱/);
  for (const file of appFiles) {
    const source = await readFile(join(process.cwd(), file), "utf8");
    assert.doesNotMatch(source, /createWechatDraft|写入公众号草稿箱/);
  }
});

test("cover crop generates a 900x383 png and updates cover json plus history", async () => {
  const root = await createTempRoot();
  try {
    await mkdir(join(root, "outputs/covers"), { recursive: true });
    const imagePath = join(root, "outputs/covers/current.png");
    await sharp({
      create: {
        width: 1200,
        height: 700,
        channels: 4,
        background: { r: 82, g: 130, b: 190, alpha: 1 }
      }
    })
      .png()
      .toFile(imagePath);
    await writeJson(root, "outputs/cover.json", {
      provider: "apimart",
      mode: "real",
      imagePath: "outputs/covers/current.png",
      title: "当前封面",
      updatedAt: "2026-06-01T00:00:00.000Z"
    });
    await writeJson(root, "outputs/cover-history.json", {
      items: [
        {
          imagePath: "outputs/covers/current.png",
          provider: "apimart",
          mode: "real",
          instruction: "initial",
          createdAt: "2026-06-01T00:00:00.000Z",
          isCurrent: true
        }
      ]
    });

    const result = await cropCover(
      { crop: { x: 100, y: 50, width: 900, height: 383 } },
      { rootDir: root }
    );
    const saved = JSON.parse(await readFile(join(root, "outputs/cover.json"), "utf8"));
    const history = JSON.parse(await readFile(join(root, "outputs/cover-history.json"), "utf8"));
    const metadata = await sharp(join(root, result.imagePath)).metadata();

    assert.equal(result.message, "cover cropped");
    assert.match(result.imagePath, /^outputs\/covers\/cover-cropped-.*\.png$/);
    assert.equal(metadata.width, 900);
    assert.equal(metadata.height, 383);
    assert.equal(saved.imagePath, result.imagePath);
    assert.equal(saved.provider, "apimart");
    assert.equal(saved.mode, "real");
    assert.equal(saved.cropApplied, true);
    assert.equal(saved.cropSourceImagePath, "outputs/covers/current.png");
    assert.equal(saved.crop.x, 100);
    assert.equal(typeof saved.updatedAt, "string");
    assert.equal(history.items[0].imagePath, result.imagePath);
    assert.equal(history.items[0].instruction, "manual crop");
    assert.equal(history.items[0].isCurrent, true);
    assert.equal(history.items.find((item: any) => item.imagePath === "outputs/covers/current.png").isCurrent, false);
    assert.equal(result.history.length, history.items.length);
    assert.doesNotMatch(JSON.stringify({ saved, history }), /freepublish|mass|sendall/i);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("cover crop rejects images outside outputs/covers", async () => {
  const root = await createTempRoot();
  try {
    await writeFile(join(root, "outputs/current.png"), Buffer.from(tinyPngBase64, "base64"));
    await writeJson(root, "outputs/cover.json", {
      provider: "apimart",
      mode: "real",
      imagePath: "outputs/current.png"
    });

    await assert.rejects(
      () => cropCover({ crop: { x: 0, y: 0, width: 1, height: 1 } }, { rootDir: root }),
      /outputs\/covers/
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("cover crop code does not call APIMart, WeChat, or publish endpoints", async () => {
  const source = await readFile(
    join(process.cwd(), "apps/dashboard/lib/editor-workflow.ts"),
    "utf8"
  );
  const cropBlock = source.match(/export async function cropCover[\s\S]*?^export async function setCurrentCoverVersion/m)?.[0] ?? "";

  assert.doesNotMatch(cropBlock, /generateApimartImage|APIMART_API|APIMART_IMAGE|fetch\(|wechatOfficialApi/i);
  assert.doesNotMatch(cropBlock, /\b(?:publish|freepublish|mass|sendall)\b/i);
});

test("cover regenerate returns imagePath and updates cover json plus history", async () => {
  const root = await createTempRoot();
  try {
    const previousCoverPath = await seedCoverRegenerateFiles(root);
    const calls: string[] = [];

    const result = await regenerateCover(
      { instruction: "标题更清晰，视觉中心更突出" },
      {
        rootDir: root,
        env: apimartEnv(),
        fetchImpl: fakeApimartFetch(calls),
        now: new Date("2026-06-02T01:02:03.000Z")
      }
    );
    const savedCover = JSON.parse(await readFile(join(root, "outputs/cover.json"), "utf8"));
    const history = JSON.parse(await readFile(join(root, "outputs/cover-history.json"), "utf8"));
    const log = await readFile(join(root, "logs/dashboard-actions.log"), "utf8");

    assert.equal(result.message, "cover regenerated");
    assert.match(result.imagePath, /^outputs\/covers\/cover-apimart-regenerated-.*\.png$/);
    assert.equal(savedCover.imagePath, result.imagePath);
    assert.equal(savedCover.provider, "apimart");
    assert.equal(savedCover.mode, "real");
    assert.equal(savedCover.regenerateInstruction, "标题更清晰，视觉中心更突出");
    assert.equal(savedCover.previousImagePath, "outputs/covers/current.png");
    assert.equal(savedCover.review.passed, true);
    assert.equal(history.items[0].imagePath, result.imagePath);
    assert.equal(history.items[0].isCurrent, true);
    assert.equal(history.items.some((item: any) => item.imagePath === "outputs/covers/current.png"), true);
    assert.equal(result.historyCount, history.items.length);
    assert.equal(calls.length, 1);
    assert.doesNotMatch(JSON.stringify(savedCover), /freepublish|mass|sendall/i);
    assert.doesNotMatch(log, /apimart-secret-value/);
    await access(join(root, result.imagePath));
    await access(previousCoverPath);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("cover regenerate failure returns readable APIMart errors and preserves current cover", async () => {
  const root = await createTempRoot();
  try {
    await seedCoverRegenerateFiles(root);
    const beforeCover = await readFile(join(root, "outputs/cover.json"), "utf8");

    await assert.rejects(
      () =>
        regenerateCover(
          { instruction: "换一版" },
          {
            rootDir: root,
            env: apimartEnv(),
            fetchImpl: (async () =>
              new Response(JSON.stringify({ error: "upstream failed" }), {
                status: 502,
                statusText: "Bad Gateway",
                headers: { "content-type": "application/json" }
              })) as typeof fetch
          }
        ),
      /APIMart 请求失败.*HTTP 502/
    );

    const afterCover = await readFile(join(root, "outputs/cover.json"), "utf8");
    const covers = await readdir(join(root, "outputs/covers"));
    const log = await readFile(join(root, "logs/dashboard-actions.log"), "utf8");

    assert.equal(afterCover, beforeCover);
    assert.equal(covers.some((file) => file.includes("cover-apimart-regenerated")), false);
    assert.match(log, /"status":"failed"/);
    assert.doesNotMatch(log, /apimart-secret-value/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("cover regenerate reports missing APIMART_API_KEY without leaking secrets", async () => {
  const root = await createTempRoot();
  try {
    await seedCoverRegenerateFiles(root);

    await assert.rejects(
      () =>
        regenerateCover(
          { instruction: "更温暖" },
          {
            rootDir: root,
            env: apimartEnv({ APIMART_API_KEY: "" }),
            fetchImpl: fakeApimartFetch()
          }
        ),
      /请先配置 APIMART_API_KEY/
    );

    const log = await readFile(join(root, "logs/dashboard-actions.log"), "utf8");
    assert.match(log, /请先配置 APIMART_API_KEY/);
    assert.doesNotMatch(log, /apimart-secret-value|Bearer/i);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("cover regenerate does not call WeChat or publish endpoints", async () => {
  const root = await createTempRoot();
  try {
    await seedCoverRegenerateFiles(root);
    const calls: string[] = [];

    await regenerateCover(
      { instruction: "" },
      {
        rootDir: root,
        env: apimartEnv(),
        fetchImpl: fakeApimartFetch(calls)
      }
    );

    assert.equal(calls.length, 1);
    assert.equal(calls.some((url) => /wechat|freepublish|mass|sendall|publish/i.test(url)), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("cover version set-current updates cover json and history", async () => {
  const root = await createTempRoot();
  try {
    await seedCoverRegenerateFiles(root);
    const nextPath = join(root, "outputs/covers/next.png");
    await writeFile(nextPath, Buffer.from(tinyPngBase64, "base64"));
    await writeJson(root, "outputs/cover-history.json", {
      items: [
        {
          imagePath: "outputs/covers/current.png",
          provider: "apimart",
          mode: "real",
          instruction: "old",
          createdAt: "2026-06-01T00:00:00.000Z",
          isCurrent: true
        },
        {
          imagePath: "outputs/covers/next.png",
          provider: "apimart",
          mode: "real",
          instruction: "new",
          createdAt: "2026-06-02T00:00:00.000Z",
          isCurrent: false
        }
      ]
    });

    const result = await setCurrentCoverVersion({ imagePath: "outputs/covers/next.png" }, { rootDir: root });
    const savedCover = JSON.parse(await readFile(join(root, "outputs/cover.json"), "utf8"));
    const history = JSON.parse(await readFile(join(root, "outputs/cover-history.json"), "utf8"));

    assert.equal(result.message, "cover version set current");
    assert.equal(savedCover.imagePath, "outputs/covers/next.png");
    assert.equal(history.items.find((item: any) => item.imagePath === "outputs/covers/next.png").isCurrent, true);
    assert.equal(history.items.find((item: any) => item.imagePath === "outputs/covers/current.png").isCurrent, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("cover version delete blocks current cover and removes non-current history", async () => {
  const root = await createTempRoot();
  try {
    await seedCoverRegenerateFiles(root);
    const oldPath = join(root, "outputs/covers/old.png");
    await writeFile(oldPath, Buffer.from(tinyPngBase64, "base64"));
    await writeJson(root, "outputs/cover-history.json", {
      items: [
        {
          imagePath: "outputs/covers/current.png",
          provider: "apimart",
          mode: "real",
          instruction: "current",
          createdAt: "2026-06-02T00:00:00.000Z",
          isCurrent: true
        },
        {
          imagePath: "outputs/covers/old.png",
          provider: "apimart",
          mode: "real",
          instruction: "old",
          createdAt: "2026-06-01T00:00:00.000Z",
          isCurrent: false
        }
      ]
    });

    await assert.rejects(
      () => deleteCoverVersion({ imagePath: "outputs/covers/current.png" }, { rootDir: root }),
      /current cover cannot be deleted/i
    );
    const result = await deleteCoverVersion({ imagePath: "outputs/covers/old.png" }, { rootDir: root });
    const history = JSON.parse(await readFile(join(root, "outputs/cover-history.json"), "utf8"));

    assert.equal(result.message, "cover version deleted");
    assert.equal(history.items.some((item: any) => item.imagePath === "outputs/covers/old.png"), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("feedback create-current uses current article data and does not overwrite existing files", async () => {
  const root = await createTempRoot();
  try {
    const today = new Date().toISOString().slice(0, 10);
    await writeJson(root, "outputs/article-meta.json", { title: "AI workflow" });
    await writeJson(root, "outputs/selected-topic.json", { selected: { title: "当前主选题" } });
    await writeJson(root, "outputs/wechat-api-draft-result.json", { media_id: "draft-media" });
    await writeJson(root, `feedback/${today}-ai-workflow.json`, { existing: true });

    const result = await createCurrentFeedback({ rootDir: root });
    const saved = JSON.parse(await readFile(join(root, result.path), "utf8"));

    assert.equal(result.path, `feedback/${today}-ai-workflow-2.json`);
    assert.equal(saved.title, "AI workflow");
    assert.equal(saved.topic, "当前主选题");
    assert.equal(saved.draftMediaId, "draft-media");
    assert.equal(saved.published, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("feedback writer saves feedback json", async () => {
  const root = await createTempRoot();
  try {
    const result = await saveFeedback(
      {
        fileName: "2026-06-01-test.json",
        feedback: {
          date: "2026-06-01",
          title: "标题",
          views: 10,
          likes: 2,
          shares: 1,
          myRating: 4,
          topicQuality: 5,
          titleQuality: 4,
          coverQuality: 3,
          notes: "复盘"
        }
      },
      { rootDir: root }
    );
    const saved = JSON.parse(await readFile(join(root, result.path), "utf8"));
    assert.equal(saved.views, 10);
    assert.equal(saved.coverQuality, 3);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("settings status never returns secret plaintext", async () => {
  const root = await createTempRoot();
  try {
    await writeFile(
      join(root, ".env"),
      [
        "REAL_PRODUCTION_MODE=true",
        "LLM_PROVIDER=minimax",
        "COVER_IMAGE_PROVIDER=apimart",
        "WECHAT_API_ENABLE_REAL_DRAFT=true",
        "MINIMAX_API_KEY=minimax-secret-value",
        "APIMART_API_KEY=apimart-secret-value",
        "WECHAT_APP_SECRET=wechat-secret-value"
      ].join("\n"),
      "utf8"
    );

    const settings = await getSettingsStatus({ rootDir: root, env: {} });
    const serialized = JSON.stringify(settings);

    assert.equal(settings.realProductionModeIsTrue, true);
    assert.equal(settings.llmProviderIsMinimax, true);
    assert.equal(settings.secretsPresent.MINIMAX_API_KEY, true);
    assert.doesNotMatch(serialized, /minimax-secret-value|apimart-secret-value|wechat-secret-value/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
