import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { forbidWechatPublishApi } from "../hooks/forbidWechatPublishApi.js";
import type { WechatApiDraftAddRequest } from "../types/wechatApiDraft.js";

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

export interface WechatOfficialApiConfig {
  apiBase: string;
  appId: string;
  appSecret: string;
}

export interface GetAccessTokenInput {
  config: WechatOfficialApiConfig;
  fetchImpl?: FetchLike;
}

export interface UploadCoverMaterialInput {
  apiBase: string;
  accessToken: string;
  imagePath: string;
  fetchImpl?: FetchLike;
}

export interface AddWechatDraftInput {
  apiBase: string;
  accessToken: string;
  request: WechatApiDraftAddRequest;
  fetchImpl?: FetchLike;
}

export interface WechatTokenResponse {
  access_token?: string;
  expires_in?: number;
  errcode?: number;
  errmsg?: string;
}

export interface WechatMaterialUploadResponse {
  media_id?: string;
  url?: string;
  errcode?: number;
  errmsg?: string;
}

export interface WechatDraftAddResponse {
  media_id?: string;
  errcode?: number;
  errmsg?: string;
}

export class WechatOfficialApiError extends Error {
  readonly errcode?: number;
  readonly errmsg?: string;

  constructor(message: string, response?: { errcode?: number; errmsg?: string }) {
    super(message);
    this.name = "WechatOfficialApiError";
    this.errcode = response?.errcode;
    this.errmsg = response?.errmsg;
  }
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function getFetch(fetchImpl?: FetchLike): FetchLike {
  return fetchImpl ?? fetch;
}

function sanitizeSensitiveText(text: string, secrets: string[]): string {
  return secrets.reduce((current, secret) => {
    if (!secret) {
      return current;
    }

    return current.split(secret).join("[redacted]");
  }, text);
}

async function parseWechatJson<T>(response: Response): Promise<T> {
  const text = await response.text();

  if (!text.trim()) {
    return {} as T;
  }

  return JSON.parse(text) as T;
}

function createApiError(
  operation: string,
  response: { errcode?: number; errmsg?: string }
): WechatOfficialApiError {
  const parts = [`WeChat ${operation} failed`];

  if (typeof response.errcode === "number") {
    parts.push(`errcode=${response.errcode}`);
  }

  if (response.errmsg) {
    parts.push(`errmsg=${response.errmsg}`);
  }

  return new WechatOfficialApiError(parts.join("; "), response);
}

function assertNoWechatApiError(
  operation: string,
  response: { errcode?: number; errmsg?: string }
): void {
  if (typeof response.errcode === "number" && response.errcode !== 0) {
    throw createApiError(operation, response);
  }
}

function assertJpgOrPng(path: string): void {
  if (!/\.(jpe?g|png)$/i.test(path)) {
    throw new Error(
      "Cover material upload requires a real JPG or PNG image. SVG/mock covers cannot be uploaded to WeChat."
    );
  }
}

export async function getAccessToken(
  input: GetAccessTokenInput
): Promise<string> {
  const url = new URL(`${trimTrailingSlash(input.config.apiBase)}/cgi-bin/token`);
  url.searchParams.set("grant_type", "client_credential");
  url.searchParams.set("appid", input.config.appId);
  url.searchParams.set("secret", input.config.appSecret);
  forbidWechatPublishApi({
    url: "/cgi-bin/token",
    actionName: "token"
  });

  try {
    const response = await getFetch(input.fetchImpl)(url);
    const json = await parseWechatJson<WechatTokenResponse>(response);
    assertNoWechatApiError("access token request", json);

    if (!response.ok || !json.access_token) {
      throw createApiError("access token request", json);
    }

    return json.access_token;
  } catch (error) {
    if (error instanceof WechatOfficialApiError) {
      throw error;
    }

    const message =
      error instanceof Error
        ? sanitizeSensitiveText(error.message, [
            input.config.appSecret,
            input.config.appId
          ])
        : "Unknown token request error.";
    throw new WechatOfficialApiError(
      `WeChat access token request failed before a valid response: ${message}`
    );
  }
}

export async function uploadCoverMaterial(
  input: UploadCoverMaterialInput
): Promise<string> {
  assertJpgOrPng(input.imagePath);
  const url = new URL(
    `${trimTrailingSlash(input.apiBase)}/cgi-bin/material/add_material`
  );
  url.searchParams.set("access_token", input.accessToken);
  url.searchParams.set("type", "thumb");
  forbidWechatPublishApi({
    url: "/cgi-bin/material/add_material",
    actionName: "上传封面素材"
  });

  const image = await readFile(input.imagePath);
  const form = new FormData();
  form.append("media", new Blob([image]), basename(input.imagePath));

  try {
    const response = await getFetch(input.fetchImpl)(url, {
      method: "POST",
      body: form
    });
    const json = await parseWechatJson<WechatMaterialUploadResponse>(response);
    assertNoWechatApiError("cover material upload", json);

    if (!response.ok || !json.media_id) {
      throw new WechatOfficialApiError(
        "WeChat cover material upload did not return media_id. TODO: confirm the current official multipart field contract for thumb material upload before retrying.",
        json
      );
    }

    return json.media_id;
  } catch (error) {
    if (error instanceof WechatOfficialApiError) {
      throw error;
    }

    const message =
      error instanceof Error
        ? sanitizeSensitiveText(error.message, [input.accessToken])
        : "Unknown cover material upload error.";
    throw new WechatOfficialApiError(
      `WeChat cover material upload failed before a valid response: ${message}`
    );
  }
}

export async function addWechatDraft(
  input: AddWechatDraftInput
): Promise<string> {
  const url = new URL(`${trimTrailingSlash(input.apiBase)}/cgi-bin/draft/add`);
  url.searchParams.set("access_token", input.accessToken);
  forbidWechatPublishApi({
    url: "/cgi-bin/draft/add",
    actionName: "创建草稿"
  });

  try {
    const response = await getFetch(input.fetchImpl)(url, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify(input.request)
    });
    const json = await parseWechatJson<WechatDraftAddResponse>(response);
    assertNoWechatApiError("draft add request", json);

    if (!response.ok || !json.media_id) {
      throw createApiError("draft add request", json);
    }

    return json.media_id;
  } catch (error) {
    if (error instanceof WechatOfficialApiError) {
      throw error;
    }

    const message =
      error instanceof Error
        ? sanitizeSensitiveText(error.message, [input.accessToken])
        : "Unknown draft add error.";
    throw new WechatOfficialApiError(
      `WeChat draft add request failed before a valid response: ${message}`
    );
  }
}
