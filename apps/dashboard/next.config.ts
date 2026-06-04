import type { NextConfig } from "next";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

loadRootDotEnv();

const nextConfig: NextConfig = {
  output: "standalone",
  webpack(config) {
    config.resolve.extensionAlias = {
      ...(config.resolve.extensionAlias ?? {}),
      ".js": [".ts", ".tsx", ".js"],
      ".mjs": [".mts", ".mjs"],
      ".cjs": [".cts", ".cjs"]
    };

    return config;
  }
};

export default nextConfig;

function loadRootDotEnv(): void {
  const dashboardDir = dirname(fileURLToPath(import.meta.url));
  const rootDotEnvPath = join(dashboardDir, "..", "..", ".env");

  if (!existsSync(rootDotEnvPath)) {
    return;
  }

  const content = readFileSync(rootDotEnvPath, "utf8");
  for (const line of content.replace(/^\uFEFF/, "").split(/\r?\n/)) {
    const assignment = normalizeDotEnvLine(line);
    if (!assignment) {
      continue;
    }

    const separatorIndex = assignment.indexOf("=");
    if (separatorIndex === -1) {
      continue;
    }

    const key = assignment.slice(0, separatorIndex).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || process.env[key] !== undefined) {
      continue;
    }

    process.env[key] = parseDotEnvValue(assignment.slice(separatorIndex + 1));
  }
}

function normalizeDotEnvLine(line: string): string | undefined {
  const trimmed = line.trim();

  if (!trimmed || trimmed.startsWith("#")) {
    return undefined;
  }

  return trimmed.startsWith("export ") ? trimmed.slice("export ".length).trim() : trimmed;
}

function parseDotEnvValue(rawValue: string): string {
  const trimmed = rawValue.trim();

  if (!trimmed) {
    return "";
  }

  if (trimmed.startsWith('"') || trimmed.startsWith("'")) {
    return parseQuotedDotEnvValue(trimmed, trimmed[0]);
  }

  const commentIndex = findInlineCommentIndex(trimmed);
  return (commentIndex === -1 ? trimmed : trimmed.slice(0, commentIndex)).trim();
}

function parseQuotedDotEnvValue(value: string, quote: string): string {
  let closingIndex = -1;

  for (let index = 1; index < value.length; index += 1) {
    if (value[index] === quote && (quote === "'" || !isEscaped(value, index))) {
      closingIndex = index;
      break;
    }
  }

  const inner = closingIndex === -1 ? value.slice(1) : value.slice(1, closingIndex);
  return quote === '"'
    ? inner
        .replace(/\\n/g, "\n")
        .replace(/\\r/g, "\r")
        .replace(/\\t/g, "\t")
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, "\\")
    : inner;
}

function findInlineCommentIndex(value: string): number {
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] === "#" && (index === 0 || /\s/.test(value[index - 1]))) {
      return index;
    }
  }

  return -1;
}

function isEscaped(value: string, index: number): boolean {
  let slashCount = 0;

  for (let cursor = index - 1; cursor >= 0 && value[cursor] === "\\"; cursor -= 1) {
    slashCount += 1;
  }

  return slashCount % 2 === 1;
}
