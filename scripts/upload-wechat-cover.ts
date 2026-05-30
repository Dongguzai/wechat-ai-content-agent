import { stat } from "node:fs/promises";
import { basename, extname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { loadDotEnv } from "../src/config/env.js";
import {
  getAccessToken,
  uploadCoverMaterial
} from "../src/adapters/wechatOfficialApi.js";

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

export interface UploadWechatCoverOptions {
  env?: NodeJS.ProcessEnv;
  fetchImpl?: FetchLike;
  dryRun?: boolean;
}

export interface UploadWechatCoverCliOptions extends UploadWechatCoverOptions {
  argv?: string[];
  stdout?: (message: string) => void;
  stderr?: (message: string) => void;
}

const allowedCoverExtensions = new Set([".jpg", ".jpeg", ".png"]);

function requiredEnv(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim() ?? "";

  if (!value) {
    throw new Error(`${name} is required.`);
  }

  return value;
}

function assertAllowedImageExtension(imagePath: string): void {
  const extension = extname(imagePath).toLowerCase();

  if (extension === ".svg") {
    throw new Error(
      "WECHAT_COVER_IMAGE_PATH must be a JPG, PNG, or JPEG image. SVG files are not allowed."
    );
  }

  if (!allowedCoverExtensions.has(extension)) {
    throw new Error(
      "WECHAT_COVER_IMAGE_PATH must be a JPG, PNG, or JPEG image."
    );
  }
}

async function assertExistingImageFile(imagePath: string): Promise<void> {
  try {
    const file = await stat(imagePath);

    if (!file.isFile()) {
      throw new Error("path is not a file");
    }
  } catch {
    throw new Error(
      `WECHAT_COVER_IMAGE_PATH must point to an existing image file: ${basename(imagePath)}`
    );
  }
}

function createDryRunFetch(): FetchLike {
  return async (input, init) => {
    const url = String(input);

    if (url.includes("/cgi-bin/token")) {
      return new Response(
        JSON.stringify({
          access_token: "DRY_RUN_ACCESS_TOKEN",
          expires_in: 7200
        })
      );
    }

    if (url.includes("/cgi-bin/material/add_material")) {
      if (init?.method !== "POST") {
        return new Response(
          JSON.stringify({
            errcode: 400,
            errmsg: "material upload must use POST"
          }),
          { status: 400 }
        );
      }

      return new Response(
        JSON.stringify({
          media_id: "DRY_RUN_WECHAT_COVER_MEDIA_ID"
        })
      );
    }

    throw new Error(`Unexpected dry-run WeChat API URL: ${url}`);
  };
}

function sanitizeSensitiveText(text: string, secrets: string[]): string {
  return secrets.reduce((current, secret) => {
    if (!secret) {
      return current;
    }

    return current.split(secret).join("[redacted]");
  }, text);
}

export async function uploadWechatCover(
  options: UploadWechatCoverOptions = {}
): Promise<string> {
  const env = options.env ?? process.env;
  const appId = requiredEnv(env, "WECHAT_APP_ID");
  const appSecret = requiredEnv(env, "WECHAT_APP_SECRET");
  const imagePath = requiredEnv(env, "WECHAT_COVER_IMAGE_PATH");
  const resolvedImagePath = resolve(imagePath);

  assertAllowedImageExtension(resolvedImagePath);
  await assertExistingImageFile(resolvedImagePath);

  const fetchImpl = options.dryRun
    ? options.fetchImpl ?? createDryRunFetch()
    : options.fetchImpl;
  let accessToken = "";

  try {
    accessToken = await getAccessToken({
      config: {
        apiBase: env.WECHAT_API_BASE || "https://api.weixin.qq.com",
        appId,
        appSecret
      },
      fetchImpl
    });

    return await uploadCoverMaterial({
      apiBase: env.WECHAT_API_BASE || "https://api.weixin.qq.com",
      accessToken,
      imagePath: resolvedImagePath,
      fetchImpl
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error.";
    throw new Error(sanitizeSensitiveText(message, [appId, appSecret, accessToken]));
  }
}

export async function uploadWechatCoverCli(
  options: UploadWechatCoverCliOptions = {}
): Promise<number> {
  const argv = options.argv ?? process.argv.slice(2);
  const env = options.env ?? process.env;
  const dryRun =
    options.dryRun ?? (argv.includes("dry-run") || argv.includes("--dry-run"));
  const stdout = options.stdout ?? console.log;
  const stderr = options.stderr ?? console.error;
  const knownSecrets = [
    env.WECHAT_APP_ID?.trim() ?? "",
    env.WECHAT_APP_SECRET?.trim() ?? "",
    "DRY_RUN_ACCESS_TOKEN"
  ];

  try {
    const mediaId = await uploadWechatCover({
      env,
      fetchImpl: options.fetchImpl,
      dryRun
    });

    stdout(`WECHAT_COVER_MEDIA_ID=${mediaId}`);
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error.";
    stderr(
      `[wechat:upload-cover] blocked: ${sanitizeSensitiveText(
        message,
        knownSecrets
      )}`
    );
    return 1;
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  await loadDotEnv();
  process.exitCode = await uploadWechatCoverCli();
}
