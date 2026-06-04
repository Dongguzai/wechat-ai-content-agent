import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

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

interface R2Config {
  endpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  publicBaseUrl?: string;
}

function readR2Endpoint(env: NodeJS.ProcessEnv): string {
  const endpoint = env.R2_ENDPOINT?.trim() ?? "";
  const accountId = env.R2_ACCOUNT_ID?.trim() ?? "";

  if (endpoint) {
    let parsed: URL;
    try {
      parsed = new URL(endpoint);
    } catch {
      throw new Error("R2_ENDPOINT must be a valid URL.");
    }
    if (parsed.protocol !== "https:") {
      throw new Error("R2_ENDPOINT must use https://.");
    }
    if (parsed.username || parsed.password) {
      throw new Error("R2_ENDPOINT must not include credentials.");
    }
    if (parsed.pathname && parsed.pathname !== "/") {
      throw new Error("R2_ENDPOINT must not include a path; put the bucket in R2_BUCKET.");
    }
    parsed.pathname = "";
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString().replace(/\/+$/g, "");
  }

  if (!accountId) {
    throw new Error("R2 adapter requires R2_ENDPOINT or R2_ACCOUNT_ID.");
  }

  if (/^https?:\/\//i.test(accountId) || accountId.includes("/") || accountId.includes(".")) {
    throw new Error(
      "R2_ACCOUNT_ID must be only the Cloudflare account id; put the full S3 endpoint URL in R2_ENDPOINT."
    );
  }

  return `https://${accountId}.r2.cloudflarestorage.com`;
}

function readR2Config(env: NodeJS.ProcessEnv = process.env): R2Config {
  const endpoint = readR2Endpoint(env);
  const accessKeyId = env.R2_ACCESS_KEY_ID?.trim() ?? "";
  const secretAccessKey = env.R2_SECRET_ACCESS_KEY?.trim() ?? "";
  const bucket = env.R2_BUCKET?.trim() ?? "";
  const publicBaseUrl = env.R2_PUBLIC_BASE_URL?.trim();

  if (!accessKeyId || !secretAccessKey || !bucket) {
    throw new Error("R2 adapter requires R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, and R2_BUCKET.");
  }

  return {
    endpoint,
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

export function createR2Adapter(env: NodeJS.ProcessEnv = process.env): R2StorageAdapter {
  const config = readR2Config(env);
  const client = new S3Client({
    endpoint: config.endpoint,
    region: "auto",
    forcePathStyle: true,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey
    }
  });

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
