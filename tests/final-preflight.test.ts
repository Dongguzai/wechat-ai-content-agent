import assert from "node:assert/strict";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { runFinalPreflight } from "../src/pipeline/finalPreflight.js";

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function writeFinalPreflightFixture(outputDir: string): Promise<void> {
  await mkdir(outputDir, { recursive: true });
  await writeJson(join(outputDir, "article-review.json"), {
    passed: true
  });
  await writeJson(join(outputDir, "cover-review.json"), {
    passed: true
  });
  await writeJson(join(outputDir, "wechat-layout.json"), {
    allowedNextStage: true
  });
  await writeJson(join(outputDir, "wechat-api-preflight.json"), {
    mode: "api_dry_run",
    dryRun: true,
    passed: true,
    publishApiCalled: false,
    massSendApiCalled: false
  });
  await writeJson(join(outputDir, "wechat-api-draft-result.json"), {
    mode: "api_dry_run",
    status: "request_preview_generated",
    requestPreview: {
      endpoint: "/cgi-bin/draft/add",
      title: "AI 编码代理真正卷到的，不是价格，而是工作流",
      hasContent: true,
      hasThumbMediaId: true,
      contentLength: 42
    },
    safety: {
      draftOnly: true,
      publishApiCalled: false,
      massSendApiCalled: false,
      requiresHumanConfirmation: true
    },
    generatedAt: "2026-05-29T00:00:00.000Z"
  });
  await writeFile(
    join(outputDir, "wechat.html"),
    '<section style="font-size:16px;"><h1>AI 工作流</h1><p>正文 HTML。</p></section>',
    "utf8"
  );
}

test("final preflight passes when all real-draft prerequisites are satisfied", async () => {
  const outputDir = await mkdtemp(join(tmpdir(), "final-preflight-pass-"));

  try {
    await writeFinalPreflightFixture(outputDir);

    const result = await runFinalPreflight({
      outputDir,
      lockDir: join(outputDir, "locks"),
      env: {
        WECHAT_COVER_MEDIA_ID: "THUMB_MEDIA_ID_VALUE",
        WECHAT_APP_SECRET: "SUPER_SECRET_SHOULD_NOT_APPEAR"
      },
      now: new Date("2026-05-29T00:00:00.000Z")
    });

    assert.equal(result.passed, true);
    await access(join(outputDir, "final-preflight.json"));
    await access(join(outputDir, "final-preflight-report.md"));

    const outputText = [
      await readFile(join(outputDir, "final-preflight.json"), "utf8"),
      await readFile(join(outputDir, "final-preflight-report.md"), "utf8")
    ].join("\n");

    assert.doesNotMatch(outputText, /SUPER_SECRET_SHOULD_NOT_APPEAR/);
    assert.doesNotMatch(outputText, /access_token\s*[:=]/i);
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});

test("final preflight reports blocking conditions", async () => {
  const cases: Array<{
    name: string;
    mutate: (outputDir: string) => Promise<void>;
    env?: NodeJS.ProcessEnv;
    issue: RegExp;
  }> = [
    {
      name: "missing-cover-media-id",
      mutate: async () => undefined,
      env: {},
      issue: /cover media id present/
    },
    {
      name: "failed-article-review",
      mutate: async (outputDir) =>
        writeJson(join(outputDir, "article-review.json"), { passed: false }),
      issue: /article-review passed/
    },
    {
      name: "local-image-path",
      mutate: async (outputDir) =>
        writeFile(
          join(outputDir, "wechat.html"),
          '<section><img src="outputs/covers/cover.png"></section>',
          "utf8"
        ),
      issue: /local image paths/
    },
    {
      name: "forbidden-html-term",
      mutate: async (outputDir) =>
        writeFile(join(outputDir, "wechat.html"), "<section>立即发送</section>", "utf8"),
      issue: /forbidden terms/
    },
    {
      name: "dangerous-api-endpoint",
      mutate: async (outputDir) =>
        writeJson(join(outputDir, "wechat-api-draft-result.json"), {
          mode: "api_dry_run",
          status: "request_preview_generated",
          requestPreview: {
            endpoint: "/cgi-bin/freepublish/submit",
            title: "title",
            hasContent: true,
            hasThumbMediaId: true,
            contentLength: 42
          },
          safety: {
            draftOnly: true,
            publishApiCalled: false,
            massSendApiCalled: false,
            requiresHumanConfirmation: true
          },
          generatedAt: "2026-05-29T00:00:00.000Z"
        }),
      issue: /draft-only/
    },
    {
      name: "secret-output",
      mutate: async (outputDir) =>
        writeFile(join(outputDir, "article.md"), "SUPER_SECRET_VALUE\n", "utf8"),
      env: {
        WECHAT_COVER_MEDIA_ID: "THUMB_MEDIA_ID_VALUE",
        WECHAT_APP_SECRET: "SUPER_SECRET_VALUE"
      },
      issue: /outputs contain no secrets/
    }
  ];

  for (const item of cases) {
    const outputDir = await mkdtemp(join(tmpdir(), `final-preflight-${item.name}-`));

    try {
      await writeFinalPreflightFixture(outputDir);
      await item.mutate(outputDir);

      const result = await runFinalPreflight({
        outputDir,
        lockDir: join(outputDir, "locks"),
        env: item.env ?? {
          WECHAT_COVER_MEDIA_ID: "THUMB_MEDIA_ID_VALUE"
        },
        now: new Date("2026-05-29T00:00:00.000Z")
      });

      assert.equal(result.passed, false, item.name);
      assert.match(result.issues.join("\n"), item.issue, item.name);
    } finally {
      await rm(outputDir, { recursive: true, force: true });
    }
  }
});
