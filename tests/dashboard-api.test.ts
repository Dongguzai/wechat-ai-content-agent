import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import assert from "node:assert/strict";
import test from "node:test";
import { executeDashboardAction } from "../apps/dashboard/lib/actions";
import { getBriefData, getDashboardStatus, getSettingsStatus, readFileForApi } from "../apps/dashboard/lib/dashboard-data";
import {
  createCurrentFeedback,
  cropCover,
  saveArticleDraft,
  selectArticleTitle,
  selectBriefTopic
} from "../apps/dashboard/lib/editor-workflow";
import { saveApproval, saveFeedback } from "../apps/dashboard/lib/forms";

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

    const result = await selectBriefTopic({ topicId: "topic-7" }, { rootDir: root });
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

test("/brief page uses the shortlisted reading list with clickable URLs and selection buttons", async () => {
  const pageSource = await readFile(
    join(process.cwd(), "apps/dashboard/app/brief/page.tsx"),
    "utf8"
  );
  const listSource = await readFile(
    join(process.cwd(), "apps/dashboard/components/brief-topic-list.tsx"),
    "utf8"
  );

  assert.match(pageSource, /BriefTopicList/);
  assert.match(pageSource, /今日 10 条入围资讯阅读清单/);
  assert.match(listSource, /href=\{url\}/);
  assert.match(listSource, /api\/brief\/select-topic/);
  assert.match(listSource, /选择此主题/);
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

test("cover crop updates cover json without calling WeChat APIs", async () => {
  const root = await createTempRoot();
  try {
    await mkdir(join(root, "outputs/covers"), { recursive: true });
    const imagePath = join(root, "outputs/covers/current.svg");
    await writeFile(imagePath, "<svg />", "utf8");
    await writeJson(root, "outputs/cover.json", {
      provider: "apimart",
      mode: "mock",
      imagePath
    });

    const result = await cropCover(
      { crop: { x: 1, y: 2, width: 900, height: 383, scale: 1.1 } },
      { rootDir: root }
    );
    const saved = JSON.parse(await readFile(join(root, "outputs/cover.json"), "utf8"));

    assert.match(result.imagePath, /^outputs\/covers\/cover-crop-/);
    assert.equal(saved.crop.scale, 1.1);
    assert.doesNotMatch(JSON.stringify(saved), /freepublish|mass|sendall/);
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
