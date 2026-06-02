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
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  publicBaseUrl?: string;
}

function readR2Config(env: NodeJS.ProcessEnv = process.env): R2Config {
  const accountId = env.R2_ACCOUNT_ID?.trim() ?? "";
  const accessKeyId = env.R2_ACCESS_KEY_ID?.trim() ?? "";
  const secretAccessKey = env.R2_SECRET_ACCESS_KEY?.trim() ?? "";
  const bucket = env.R2_BUCKET?.trim() ?? "";
  const publicBaseUrl = env.R2_PUBLIC_BASE_URL?.trim();

  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) {
    throw new Error("R2 adapter requires R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, and R2_BUCKET.");
  }

  return {
    accountId,
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
    endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
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
