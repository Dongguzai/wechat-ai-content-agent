import { PutObjectCommand, S3Client, type S3ClientConfig } from "@aws-sdk/client-s3";

export interface R2UploadInput {
  key: string;
  body: string | Uint8Array;
  contentType: string;
}

export interface R2UploadResult {
  key: string;
  publicUrl?: string;
}

export interface R2StorageAdapter {
  putText(input: R2UploadInput): Promise<R2UploadResult>;
}

export const R2_UPLOAD_ENDPOINT_HINT = "expected https://<ACCOUNT_ID>.r2.cloudflarestorage.com";
export const R2_UPLOAD_FAILURE_HINT =
  "Check R2_ACCOUNT_ID is the 32-character hexadecimal Cloudflare account id, endpoint, region=auto, forcePathStyle=true, and do not use R2_PUBLIC_BASE_URL as upload endpoint.";
const R2_ACCOUNT_ID_PATTERN = /^[a-f0-9]{32}$/i;

export interface R2ResolvedConfig {
  accountId: string;
  endpoint: string;
  region: "auto";
  forcePathStyle: true;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  publicBaseUrl?: string;
}

export interface R2DiagnosticConfig {
  hasAccountId: boolean;
  accountIdPreview: string;
  endpointHost: string;
  hasAccessKeyId: boolean;
  hasSecretAccessKey: boolean;
  bucket: string;
  hasPublicBaseUrl: boolean;
}

function envValue(env: NodeJS.ProcessEnv, name: string): string {
  return env[name]?.trim() ?? "";
}

function validateR2AccountId(accountId: string): void {
  if (/^https?:\/\//i.test(accountId) || accountId.includes("/") || accountId.includes(".")) {
    throw new Error(
      "R2_ACCOUNT_ID must be only the Cloudflare account id; upload endpoint is derived as https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com."
    );
  }

  if (!R2_ACCOUNT_ID_PATTERN.test(accountId)) {
    throw new Error(
      "R2_ACCOUNT_ID must be the 32-character hexadecimal Cloudflare account id, not an API token, access key, bucket name, URL, or public/custom domain."
    );
  }
}

function r2EndpointForAccount(accountId: string): string {
  return `https://${accountId}.r2.cloudflarestorage.com`;
}

export function maskR2AccountId(accountId: string): string {
  const value = accountId.trim();
  if (!value) {
    return "";
  }

  if (value.length <= 10) {
    return `${value.slice(0, 2)}***${value.slice(-2)}`;
  }

  return `${value.slice(0, 6)}***${value.slice(-4)}`;
}

export function getR2ConfigDiagnostics(
  env: NodeJS.ProcessEnv = process.env
): R2DiagnosticConfig {
  const accountId = envValue(env, "R2_ACCOUNT_ID");
  const accountIdPreview = accountId ? maskR2AccountId(accountId) : "";

  return {
    hasAccountId: Boolean(accountId),
    accountIdPreview,
    endpointHost: accountId ? `${accountIdPreview}.r2.cloudflarestorage.com` : "",
    hasAccessKeyId: Boolean(envValue(env, "R2_ACCESS_KEY_ID")),
    hasSecretAccessKey: Boolean(envValue(env, "R2_SECRET_ACCESS_KEY")),
    bucket: envValue(env, "R2_BUCKET"),
    hasPublicBaseUrl: Boolean(envValue(env, "R2_PUBLIC_BASE_URL"))
  };
}

export function resolveR2AdapterConfig(
  env: NodeJS.ProcessEnv = process.env
): R2ResolvedConfig {
  const accountId = envValue(env, "R2_ACCOUNT_ID");
  if (!accountId) {
    throw new Error("R2 adapter requires R2_ACCOUNT_ID.");
  }

  validateR2AccountId(accountId);
  const accessKeyId = envValue(env, "R2_ACCESS_KEY_ID");
  const secretAccessKey = envValue(env, "R2_SECRET_ACCESS_KEY");
  const bucket = envValue(env, "R2_BUCKET");
  const publicBaseUrl = envValue(env, "R2_PUBLIC_BASE_URL");

  if (!accessKeyId || !secretAccessKey || !bucket) {
    throw new Error("R2 adapter requires R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, and R2_BUCKET.");
  }

  return {
    accountId,
    endpoint: r2EndpointForAccount(accountId),
    region: "auto",
    forcePathStyle: true,
    accessKeyId,
    secretAccessKey,
    bucket,
    publicBaseUrl: publicBaseUrl || undefined
  };
}

function publicUrlFor(baseUrl: string | undefined, key: string): string | undefined {
  if (!baseUrl) {
    return undefined;
  }

  return `${baseUrl.replace(/\/+$/g, "")}/${key.split("/").map(encodeURIComponent).join("/")}`;
}

export function createR2S3ClientConfig(config: R2ResolvedConfig): S3ClientConfig {
  return {
    region: config.region,
    endpoint: config.endpoint,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey
    },
    forcePathStyle: config.forcePathStyle
  };
}

export function createR2Adapter(env: NodeJS.ProcessEnv = process.env): R2StorageAdapter {
  const config = resolveR2AdapterConfig(env);
  const client = new S3Client(createR2S3ClientConfig(config));

  return {
    async putText(input) {
      await client.send(
        new PutObjectCommand({
          Bucket: config.bucket,
          Key: input.key,
          Body: input.body,
          ContentType: input.contentType
        })
      );

      return {
        key: input.key,
        publicUrl: publicUrlFor(config.publicBaseUrl, input.key)
      };
    }
  };
}
