import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  createNotificationConfig,
  sendNotification
} from "../src/adapters/notification.js";
import { runDailyAuto } from "../scripts/run-daily-auto.js";

test("notification is disabled by default", async () => {
  let called = false;
  const result = await sendNotification({
    config: createNotificationConfig({}),
    payload: {
      status: "failed",
      title: "失败",
      message: "not sent",
      selectedTitle: null,
      draftMediaId: null,
      reportPath: "outputs/daily-auto-report.md",
      requiresHumanConfirmation: true,
      generatedAt: "2026-05-29T00:00:00.000Z"
    },
    fetchImpl: async () => {
      called = true;
      return new Response("{}");
    }
  });

  assert.equal(result.attempted, false);
  assert.equal(called, false);
});

test("run:daily:auto sends sanitized failure webhook payload when enabled", async () => {
  const root = await mkdtemp(join(tmpdir(), "daily-auto-notify-"));
  const payloads: unknown[] = [];

  try {
    const result = await runDailyAuto({
      outputDir: join(root, "outputs"),
      logFile: join(root, "logs", "daily-auto.log"),
      lockDir: join(root, "locks"),
      runsDir: join(root, "runs"),
      loadEnv: false,
      consoleOutput: false,
      archiveRuns: false,
      now: new Date("2026-05-29T09:00:00.000Z"),
      env: {
        REAL_PRODUCTION_MODE: "false",
        RSS_ENABLE_REAL_FETCH: "true",
        SEARCH_ENABLE_REAL_API: "true",
        TAVILY_API_KEY: "TAVILY_KEY_VALUE",
        COVER_ENABLE_REAL_API: "true",
        APIMART_API_KEY: "APIMART_SECRET_VALUE",
        APIMART_IMAGE_API_URL: "https://api.apimart.test/images",
        WECHAT_API_ENABLE_REAL_DRAFT: "true",
        WECHAT_DRAFT_ALLOW_REAL_API: "true",
        WECHAT_APP_ID: "APP_ID_VALUE",
        WECHAT_APP_SECRET: "APP_SECRET_VALUE",
        NOTIFY_ENABLE: "true",
        NOTIFY_METHOD: "webhook",
        NOTIFY_WEBHOOK_URL: "https://notify.test/webhook",
        NOTIFY_ON_FAILURE: "true"
      },
      notifyFetchImpl: async (_input, init) => {
        payloads.push(JSON.parse(String(init?.body)));
        return new Response("{}", { status: 200 });
      }
    });
    const serialized = JSON.stringify(payloads);
    const log = await readFile(join(root, "logs", "daily-auto.log"), "utf8");

    assert.equal(result.status, "failed");
    assert.equal(payloads.length, 1);
    assert.match(serialized, /"status":"failed"/);
    assert.match(serialized, /"requiresHumanConfirmation":true/);
    assert.doesNotMatch(serialized, /APP_SECRET_VALUE/);
    assert.doesNotMatch(serialized, /access_token/i);
    assert.doesNotMatch(serialized, /APIMART_SECRET_VALUE/);
    assert.doesNotMatch(serialized, /APIMART_API_KEY/i);
    assert.doesNotMatch(log, /https:\/\/notify\.test\/webhook/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
