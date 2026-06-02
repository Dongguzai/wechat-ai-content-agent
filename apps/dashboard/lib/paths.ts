import { access, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { redactSecrets } from "./redaction";

export interface DashboardFsOptions {
  rootDir?: string;
}

export interface SafeFileReadResult {
  path: string;
  absolutePath: string;
  contentType: string;
  encoding: "utf8" | "base64";
  content: string;
  size: number;
}

export const ALLOWED_READ_ROOTS = ["outputs", "runs", "feedback", "inputs", "docs"] as const;

const DENIED_SEGMENTS = new Set([".git", "node_modules"]);
const DENIED_FILE_PATTERN = /(^\.env($|\.)|access[-_]?token|app[-_]?secret|cookie|credential|session)/i;

export function findRepoRoot(startDir = process.cwd()): string {
  let current = path.resolve(startDir);

  for (;;) {
    const packagePath = path.join(current, "package.json");
    const srcPath = path.join(current, "src");
    const scriptsPath = path.join(current, "scripts");

    if (existsSync(packagePath) && existsSync(srcPath) && existsSync(scriptsPath)) {
      try {
        const packageJson = JSON.parse(readFileSync(packagePath, "utf8")) as {
          name?: string;
        };
        if (packageJson.name === "wechat-ai-content-agent") {
          return current;
        }
      } catch {
        return current;
      }
    }

    const parent = path.dirname(current);
    if (parent === current) {
      return path.resolve(startDir);
    }
    current = parent;
  }
}

export function getRepoRoot(options: DashboardFsOptions = {}): string {
  return path.resolve(options.rootDir ?? findRepoRoot());
}

export function toPosixPath(value: string): string {
  return value.split(path.sep).join("/");
}

export function isInside(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export function resolveSafeReadPath(
  requestedPath: string,
  options: DashboardFsOptions = {}
): { root: string; absolutePath: string; relativePath: string } {
  if (!requestedPath || requestedPath.includes("\0")) {
    throw new Error("A file path is required.");
  }

  if (path.isAbsolute(requestedPath)) {
    throw new Error("Absolute paths are not allowed.");
  }

  const normalized = path.normalize(requestedPath);
  const segments = normalized.split(path.sep).filter(Boolean);

  if (segments.length === 0 || normalized.startsWith("..")) {
    throw new Error("Path traversal is not allowed.");
  }

  if (!ALLOWED_READ_ROOTS.includes(segments[0] as (typeof ALLOWED_READ_ROOTS)[number])) {
    throw new Error("Path is outside the dashboard allowlist.");
  }

  for (const segment of segments) {
    if (DENIED_SEGMENTS.has(segment) || DENIED_FILE_PATTERN.test(segment)) {
      throw new Error("This path is blocked by the dashboard safety policy.");
    }
  }

  const root = getRepoRoot(options);
  const allowedRoot = path.resolve(root, segments[0]);
  const absolutePath = path.resolve(root, normalized);

  if (!isInside(allowedRoot, absolutePath)) {
    throw new Error("Path is outside the dashboard allowlist.");
  }

  return {
    root,
    absolutePath,
    relativePath: toPosixPath(path.relative(root, absolutePath))
  };
}

export function relativePathFromMaybeAbsolute(
  filePath: string | undefined,
  options: DashboardFsOptions = {}
): string | undefined {
  if (!filePath) {
    return undefined;
  }

  const root = getRepoRoot(options);
  const absolutePath = path.isAbsolute(filePath)
    ? path.resolve(filePath)
    : path.resolve(root, filePath);

  if (!isInside(root, absolutePath)) {
    return undefined;
  }

  return toPosixPath(path.relative(root, absolutePath));
}

export async function safeFileExists(
  relativePath: string,
  options: DashboardFsOptions = {}
): Promise<boolean> {
  try {
    const resolved = resolveSafeReadPath(relativePath, options);
    const stats = await stat(resolved.absolutePath);
    return stats.isFile();
  } catch {
    return false;
  }
}

export async function readJsonFile<T>(
  relativePath: string,
  options: DashboardFsOptions = {}
): Promise<T | undefined> {
  try {
    const resolved = resolveSafeReadPath(relativePath, options);
    const content = await readFile(resolved.absolutePath, "utf8");
    return JSON.parse(content) as T;
  } catch {
    return undefined;
  }
}

export async function readTextFile(
  relativePath: string,
  options: DashboardFsOptions = {}
): Promise<string | undefined> {
  try {
    const resolved = resolveSafeReadPath(relativePath, options);
    return await readFile(resolved.absolutePath, "utf8");
  } catch {
    return undefined;
  }
}

export async function readSafeDashboardFile(
  requestedPath: string,
  options: DashboardFsOptions = {}
): Promise<SafeFileReadResult> {
  const resolved = resolveSafeReadPath(requestedPath, options);
  const stats = await stat(resolved.absolutePath);

  if (!stats.isFile()) {
    throw new Error("Only files can be read.");
  }

  const contentType = contentTypeForPath(resolved.absolutePath);
  const isText = contentType.startsWith("text/") || contentType === "application/json";
  const buffer = await readFile(resolved.absolutePath);

  return {
    path: resolved.relativePath,
    absolutePath: resolved.absolutePath,
    contentType,
    encoding: isText ? "utf8" : "base64",
    content: isText ? redactSecrets(buffer.toString("utf8")) : buffer.toString("base64"),
    size: stats.size
  };
}

export async function readImageAsDataUrl(
  filePath: string | undefined,
  options: DashboardFsOptions = {}
): Promise<{ dataUrl: string; relativePath: string } | undefined> {
  const relativePath = relativePathFromMaybeAbsolute(filePath, options);
  if (!relativePath) {
    return undefined;
  }

  const contentType = contentTypeForPath(relativePath);
  if (!contentType.startsWith("image/")) {
    return undefined;
  }

  const resolved = resolveSafeReadPath(relativePath, options);
  const buffer = await readFile(resolved.absolutePath).catch(() => undefined);
  if (!buffer) {
    return undefined;
  }

  return {
    dataUrl: `data:${contentType};base64,${buffer.toString("base64")}`,
    relativePath: resolved.relativePath
  };
}

export async function listDirectory(
  relativePath: string,
  options: DashboardFsOptions = {}
): Promise<string[]> {
  const resolved = resolveSafeReadPath(relativePath, options);
  const stats = await stat(resolved.absolutePath).catch(() => undefined);
  if (!stats?.isDirectory()) {
    return [];
  }
  return await readdir(resolved.absolutePath);
}

export async function ensureDir(relativePath: string, options: DashboardFsOptions = {}): Promise<void> {
  const root = getRepoRoot(options);
  await mkdir(path.join(root, relativePath), { recursive: true });
}

export async function writeJsonRelative(
  relativePath: string,
  value: unknown,
  options: DashboardFsOptions = {}
): Promise<string> {
  const root = getRepoRoot(options);
  const absolutePath = path.resolve(root, relativePath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  return toPosixPath(path.relative(root, absolutePath));
}

export async function pathExists(absolutePath: string): Promise<boolean> {
  try {
    await access(absolutePath);
    return true;
  } catch {
    return false;
  }
}

export function contentTypeForPath(filePath: string): string {
  const extension = path.extname(filePath).toLowerCase();
  switch (extension) {
    case ".json":
      return "application/json";
    case ".md":
    case ".txt":
      return "text/plain; charset=utf-8";
    case ".html":
      return "text/html; charset=utf-8";
    case ".svg":
      return "image/svg+xml";
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".webp":
      return "image/webp";
    default:
      return "application/octet-stream";
  }
}
