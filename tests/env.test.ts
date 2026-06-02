import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { checkEnvironment } from "../scripts/check-env.js";
import {
  loadDotEnv,
  miniMaxDotEnvOverrideKeys,
  parseDotEnv
} from "../src/config/env.js";

function entriesToEnv(content: string): NodeJS.ProcessEnv {
  const parsed = parseDotEnv(content);

  assert.deepEqual(parsed.errors, []);
  return Object.fromEntries(
    parsed.entries.map((entry) => [entry.key, entry.value])
  ) as NodeJS.ProcessEnv;
}

test(".env parser supports comments, export, and quoted values", () => {
  const parsed = parseDotEnv(
    [
      "# comment",
      "export PLAIN=value # inline comment",
      'DOUBLE_QUOTED="line one\\nline two"',
      "SINGLE_QUOTED='value # not a comment'",
      "EMPTY="
    ].join("\n")
  );
  const values = new Map(parsed.entries.map((entry) => [entry.key, entry.value]));

  assert.deepEqual(parsed.errors, []);
  assert.equal(values.get("PLAIN"), "value");
  assert.equal(values.get("DOUBLE_QUOTED"), "line one\nline two");
  assert.equal(values.get("SINGLE_QUOTED"), "value # not a comment");
  assert.equal(values.get("EMPTY"), "");
});

test("loadDotEnv keeps shell values unless override is enabled", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "dotenv-load-"));

  try {
    await writeFile(
      join(tempDir, ".env"),
      ["FROM_FILE=file-value", "FROM_SHELL=file-value"].join("\n"),
      "utf8"
    );

    const env: NodeJS.ProcessEnv = {
      FROM_SHELL: "shell-value"
    };
    const result = await loadDotEnv({
      cwd: tempDir,
      env
    });

    assert.equal(result.loaded, true);
    assert.equal(env.FROM_FILE, "file-value");
    assert.equal(env.FROM_SHELL, "shell-value");
    assert.deepEqual(result.appliedKeys, ["FROM_FILE"]);
    assert.deepEqual(result.skippedKeys, ["FROM_SHELL"]);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("loadDotEnv can force MiniMax key from .env without overriding other shell values", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "dotenv-minimax-key-"));

  try {
    await writeFile(
      join(tempDir, ".env"),
      [
        "MINIMAX_API_KEY=file-minimax-key",
        "MINIMAX_BASE_URL=https://api.minimaxi.com/v1"
      ].join("\n"),
      "utf8"
    );

    const env: NodeJS.ProcessEnv = {
      MINIMAX_API_KEY: "stale-shell-key",
      MINIMAX_BASE_URL: "https://shell.example/v1"
    };
    const result = await loadDotEnv({
      cwd: tempDir,
      env,
      overrideKeys: [...miniMaxDotEnvOverrideKeys]
    });

    assert.equal(env.MINIMAX_API_KEY, "file-minimax-key");
    assert.equal(env.MINIMAX_BASE_URL, "https://shell.example/v1");
    assert.deepEqual(result.appliedKeys, ["MINIMAX_API_KEY"]);
    assert.deepEqual(result.skippedKeys, ["MINIMAX_BASE_URL"]);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test(".env.example covers code env references and passes default validation", async () => {
  const exampleContent = await readFile(join(process.cwd(), ".env.example"), "utf8");
  const result = await checkEnvironment({
    projectRoot: process.cwd(),
    dotenvPath: null,
    env: entriesToEnv(exampleContent)
  });

  assert.deepEqual(result.errors, []);
  assert.match(result.info.join("\n"), /dry-run\/preflight only/);
});

test("env check catches unknown local keys and invalid values", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "dotenv-check-"));

  try {
    const dotenvPath = join(tempDir, ".env");
    await writeFile(
      dotenvPath,
      ["SEARCH_ENABLE_REAL_API=yes", "UNKNOWN_LOCAL_KEY=value"].join("\n"),
      "utf8"
    );

    const result = await checkEnvironment({
      projectRoot: process.cwd(),
      dotenvPath,
      env: {}
    });

    assert.equal(result.ok, false);
    assert.ok(
      result.errors.some((error) =>
        error.includes("SEARCH_ENABLE_REAL_API must be either true or false")
      )
    );
    assert.ok(
      result.errors.some((error) => error.includes("UNKNOWN_LOCAL_KEY"))
    );
    assert.doesNotMatch(result.errors.join("\n"), /value/);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("env check explains dry-run and real WeChat draft modes", async () => {
  const dryRun = await checkEnvironment({
    projectRoot: process.cwd(),
    dotenvPath: null,
    env: {
      WECHAT_API_ENABLE_REAL_DRAFT: "false",
      WECHAT_DRAFT_ALLOW_REAL_API: "false",
      WECHAT_DRAFT_DRY_RUN: "true",
      WECHAT_FORBID_PUBLISH: "true",
      WECHAT_FORBID_MASS_SEND: "true"
    }
  });
  const realMode = await checkEnvironment({
    projectRoot: process.cwd(),
    dotenvPath: null,
    env: {
      WECHAT_API_ENABLE_REAL_DRAFT: "true",
      WECHAT_DRAFT_ALLOW_REAL_API: "true",
      WECHAT_DRAFT_DRY_RUN: "false",
      WECHAT_APP_ID: "APP_ID_VALUE",
      WECHAT_APP_SECRET: "APP_SECRET_VALUE",
      WECHAT_COVER_MEDIA_ID: "THUMB_MEDIA_ID_VALUE",
      WECHAT_FORBID_PUBLISH: "true",
      WECHAT_FORBID_MASS_SEND: "true"
    }
  });

  assert.deepEqual(dryRun.errors, []);
  assert.deepEqual(realMode.errors, []);
  assert.match(dryRun.info.join("\n"), /no real draft creation/);
  assert.match(realMode.info.join("\n"), /real API draft creation is configured/);
  assert.match(realMode.info.join("\n"), /does not call WeChat API/);
});

test("env check requires APIMart endpoint for real cover mode", async () => {
  const missingUrl = await checkEnvironment({
    projectRoot: process.cwd(),
    dotenvPath: null,
    env: {
      COVER_ENABLE_REAL_API: "true",
      APIMART_API_KEY: "APIMART_KEY_VALUE",
      APIMART_IMAGE_MODEL: "gpt-image-2",
      APIMART_IMAGE_SIZE: "16:9",
      APIMART_IMAGE_RESOLUTION: "2k",
      WECHAT_FORBID_PUBLISH: "true",
      WECHAT_FORBID_MASS_SEND: "true"
    }
  });
  const ready = await checkEnvironment({
    projectRoot: process.cwd(),
    dotenvPath: null,
    env: {
      COVER_ENABLE_REAL_API: "true",
      APIMART_API_KEY: "APIMART_KEY_VALUE",
      APIMART_IMAGE_API_URL: "https://api.apimart.test/images",
      APIMART_IMAGE_MODEL: "gpt-image-2",
      APIMART_IMAGE_SIZE: "16:9",
      APIMART_IMAGE_RESOLUTION: "2k",
      WECHAT_FORBID_PUBLISH: "true",
      WECHAT_FORBID_MASS_SEND: "true"
    }
  });

  assert.equal(missingUrl.ok, false);
  assert.ok(
    missingUrl.errors.some((error) =>
      error.includes("COVER_ENABLE_REAL_API=true requires APIMART_IMAGE_API_URL")
    )
  );
  assert.deepEqual(ready.errors, []);
});
