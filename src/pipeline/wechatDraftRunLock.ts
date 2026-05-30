import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  WechatDraftRunLock,
  WechatDraftRunLockState
} from "../types/runLock.js";
import { formatLocalDateKey } from "../utils/dateFormat.js";

export interface WechatDraftRunLockOptions {
  lockDir?: string;
  now?: Date;
}

export interface AssertWechatDraftRunLockOptions
  extends WechatDraftRunLockOptions {
  force?: boolean;
}

export interface WriteWechatDraftRunLockOptions
  extends WechatDraftRunLockOptions {
  mediaId: string;
  title: string;
  force?: boolean;
}

const currentDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(currentDir, "..", "..");
const defaultLockDir = join(projectRoot, ".local", "wechat-draft-locks");

function lockFileFor(input: WechatDraftRunLockOptions = {}): {
  date: string;
  lockDir: string;
  lockFile: string;
} {
  const date = formatLocalDateKey(input.now ?? new Date());
  const lockDir = input.lockDir ?? defaultLockDir;

  return {
    date,
    lockDir,
    lockFile: join(lockDir, `${date}.json`)
  };
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function isWechatDraftRunLock(value: unknown): value is WechatDraftRunLock {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<WechatDraftRunLock>;
  return (
    candidate.version === 1 &&
    typeof candidate.date === "string" &&
    typeof candidate.createdAt === "string" &&
    typeof candidate.mediaId === "string" &&
    typeof candidate.title === "string" &&
    typeof candidate.forced === "boolean" &&
    candidate.source === "wechat_official_api"
  );
}

export async function readWechatDraftRunLock(
  options: WechatDraftRunLockOptions = {}
): Promise<WechatDraftRunLockState> {
  const { date, lockFile } = lockFileFor(options);

  try {
    const lock = JSON.parse(await readFile(lockFile, "utf8")) as unknown;

    if (!isWechatDraftRunLock(lock) || lock.date !== date) {
      return {
        date,
        lockFile,
        locked: true,
        invalidReason: "Existing lock file is malformed."
      };
    }

    return {
      date,
      lockFile,
      locked: true,
      lock
    };
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return {
        date,
        lockFile,
        locked: false
      };
    }

    if (error instanceof SyntaxError) {
      return {
        date,
        lockFile,
        locked: true,
        invalidReason: "Existing lock file is not valid JSON."
      };
    }

    throw error;
  }
}

export async function assertWechatDraftRunNotLocked(
  options: AssertWechatDraftRunLockOptions = {}
): Promise<WechatDraftRunLockState> {
  const state = await readWechatDraftRunLock(options);

  if (state.locked && !options.force) {
    const createdAt = state.lock?.createdAt ?? "unknown time";
    throw new Error(
      `A real WeChat draft was already created on ${state.date} at ${createdAt}. Use --force to override.`
    );
  }

  return state;
}

export async function writeWechatDraftRunLock(
  options: WriteWechatDraftRunLockOptions
): Promise<WechatDraftRunLock> {
  const { date, lockDir, lockFile } = lockFileFor(options);
  const lock: WechatDraftRunLock = {
    version: 1,
    date,
    createdAt: (options.now ?? new Date()).toISOString(),
    mediaId: options.mediaId,
    title: options.title,
    forced: options.force === true,
    source: "wechat_official_api"
  };

  await mkdir(lockDir, { recursive: true });
  await writeFile(lockFile, `${JSON.stringify(lock, null, 2)}\n`, "utf8");

  return lock;
}
