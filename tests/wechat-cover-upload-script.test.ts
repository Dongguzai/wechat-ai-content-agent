import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  uploadWechatCover,
  uploadWechatCoverCli
} from "../scripts/upload-wechat-cover.js";

function envWithCover(
  imagePath: string,
  overrides: NodeJS.ProcessEnv = {}
): NodeJS.ProcessEnv {
  return {
    WECHAT_APP_ID: "APP_ID_VALUE",
    WECHAT_APP_SECRET: "APP_SECRET_VALUE",
    WECHAT_COVER_IMAGE_PATH: imagePath,
    WECHAT_API_BASE: "https://api.weixin.qq.com",
    ...overrides
  };
}

test("upload cover blocks SVG before calling WeChat", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "wechat-cover-svg-"));

  try {
    const imagePath = join(tempDir, "cover.svg");
    await writeFile(imagePath, "<svg />\n", "utf8");

    await assert.rejects(
      () =>
        uploadWechatCover({
          env: envWithCover(imagePath),
          dryRun: true,
          fetchImpl: async () => {
            throw new Error("fetch should not be called for SVG covers");
          }
        }),
      /SVG files are not allowed/
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("upload cover blocks missing AppID and AppSecret", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "wechat-cover-missing-env-"));

  try {
    const imagePath = join(tempDir, "cover.png");
    await writeFile(imagePath, "not-a-real-image-but-extension-is-valid", "utf8");

    await assert.rejects(
      () =>
        uploadWechatCover({
          env: envWithCover(imagePath, { WECHAT_APP_ID: "" }),
          dryRun: true
        }),
      /WECHAT_APP_ID is required/
    );
    await assert.rejects(
      () =>
        uploadWechatCover({
          env: envWithCover(imagePath, { WECHAT_APP_SECRET: "" }),
          dryRun: true
        }),
      /WECHAT_APP_SECRET is required/
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("upload cover requires an existing JPG, PNG, or JPEG path", async () => {
  await assert.rejects(
    () =>
      uploadWechatCover({
        env: envWithCover(join(tmpdir(), "missing-cover.png")),
        dryRun: true
      }),
    /existing image file/
  );

  const tempDir = await mkdtemp(join(tmpdir(), "wechat-cover-extension-"));

  try {
    const imagePath = join(tempDir, "cover.gif");
    await writeFile(imagePath, "gif89a", "utf8");

    await assert.rejects(
      () =>
        uploadWechatCover({
          env: envWithCover(imagePath),
          dryRun: true
        }),
      /must be a JPG, PNG, or JPEG image/
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("dry-run uploads cover through token and material endpoints only", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "wechat-cover-dry-run-"));
  const calls: string[] = [];

  try {
    const imagePath = join(tempDir, "cover.jpeg");
    await writeFile(imagePath, "jpeg-bytes", "utf8");

    const mediaId = await uploadWechatCover({
      env: envWithCover(imagePath),
      dryRun: true,
      fetchImpl: async (input, init) => {
        const url = String(input);
        calls.push(url);

        if (url.includes("/cgi-bin/token")) {
          return new Response(
            JSON.stringify({
              access_token: "ACCESS_TOKEN_VALUE",
              expires_in: 7200
            })
          );
        }

        if (url.includes("/cgi-bin/material/add_material")) {
          assert.equal(init?.method, "POST");
          return new Response(
            JSON.stringify({
              media_id: "MEDIA_ID_VALUE"
            })
          );
        }

        throw new Error(`unexpected URL ${url}`);
      }
    });

    assert.equal(mediaId, "MEDIA_ID_VALUE");
    assert.equal(calls.length, 2);
    assert.equal(calls.some((url) => url.includes("/cgi-bin/draft/add")), false);
    assert.equal(calls.some((url) => url.includes("freepublish")), false);
    assert.equal(calls.some((url) => url.includes("publish")), false);
    assert.equal(calls.some((url) => url.includes("mass")), false);
    assert.equal(calls.some((url) => url.includes("sendall")), false);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("CLI success prints only WECHAT_COVER_MEDIA_ID and no secret or token", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "wechat-cover-no-secret-output-"));
  const stdout: string[] = [];
  const stderr: string[] = [];

  try {
    const imagePath = join(tempDir, "cover.jpg");
    await writeFile(imagePath, "jpg-bytes", "utf8");

    const exitCode = await uploadWechatCoverCli({
      argv: ["dry-run"],
      env: envWithCover(imagePath, {
        WECHAT_APP_SECRET: "SUPER_SECRET_SHOULD_NOT_APPEAR"
      }),
      stdout: (message) => stdout.push(message),
      stderr: (message) => stderr.push(message),
      fetchImpl: async (input) => {
        const url = String(input);

        if (url.includes("/cgi-bin/token")) {
          return new Response(
            JSON.stringify({
              access_token: "ACCESS_TOKEN_SHOULD_NOT_APPEAR",
              expires_in: 7200
            })
          );
        }

        return new Response(
          JSON.stringify({
            media_id: "MEDIA_ID_VALUE"
          })
        );
      }
    });
    const combinedOutput = [...stdout, ...stderr].join("\n");

    assert.equal(exitCode, 0);
    assert.deepEqual(stdout, ["WECHAT_COVER_MEDIA_ID=MEDIA_ID_VALUE"]);
    assert.deepEqual(stderr, []);
    assert.doesNotMatch(combinedOutput, /SUPER_SECRET_SHOULD_NOT_APPEAR/);
    assert.doesNotMatch(combinedOutput, /ACCESS_TOKEN_SHOULD_NOT_APPEAR/);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("CLI error output redacts AppSecret and access token", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "wechat-cover-redacted-error-"));
  const stdout: string[] = [];
  const stderr: string[] = [];

  try {
    const imagePath = join(tempDir, "cover.png");
    await writeFile(imagePath, "png-bytes", "utf8");

    const exitCode = await uploadWechatCoverCli({
      argv: ["dry-run"],
      env: envWithCover(imagePath, {
        WECHAT_APP_SECRET: "SUPER_SECRET_SHOULD_NOT_APPEAR"
      }),
      stdout: (message) => stdout.push(message),
      stderr: (message) => stderr.push(message),
      fetchImpl: async (input) => {
        const url = String(input);

        if (url.includes("/cgi-bin/token")) {
          return new Response(
            JSON.stringify({
              access_token: "ACCESS_TOKEN_SHOULD_NOT_APPEAR",
              expires_in: 7200
            })
          );
        }

        return new Response(
          JSON.stringify({
            errcode: 40001,
            errmsg:
              "invalid token ACCESS_TOKEN_SHOULD_NOT_APPEAR for SUPER_SECRET_SHOULD_NOT_APPEAR"
          }),
          { status: 400 }
        );
      }
    });
    const combinedOutput = [...stdout, ...stderr].join("\n");

    assert.equal(exitCode, 1);
    assert.deepEqual(stdout, []);
    assert.doesNotMatch(combinedOutput, /SUPER_SECRET_SHOULD_NOT_APPEAR/);
    assert.doesNotMatch(combinedOutput, /ACCESS_TOKEN_SHOULD_NOT_APPEAR/);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
