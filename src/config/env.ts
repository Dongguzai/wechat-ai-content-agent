import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export interface DotEnvEntry {
  key: string;
  value: string;
  line: number;
}

export interface DotEnvParseError {
  line: number;
  message: string;
}

export interface DotEnvParseResult {
  entries: DotEnvEntry[];
  errors: DotEnvParseError[];
}

export interface LoadDotEnvOptions {
  cwd?: string;
  path?: string;
  env?: NodeJS.ProcessEnv;
  override?: boolean;
}

export interface LoadDotEnvResult {
  loaded: boolean;
  path: string;
  appliedKeys: string[];
  skippedKeys: string[];
  parsedKeys: string[];
}

const currentDir = dirname(fileURLToPath(import.meta.url));
export const projectRoot = join(currentDir, "..", "..");
const envNamePattern = /^[A-Za-z_][A-Za-z0-9_]*$/;

function isEscaped(value: string, index: number): boolean {
  let slashCount = 0;

  for (let cursor = index - 1; cursor >= 0 && value[cursor] === "\\"; cursor -= 1) {
    slashCount += 1;
  }

  return slashCount % 2 === 1;
}

function decodeDoubleQuotedValue(value: string): string {
  return value
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\r")
    .replace(/\\t/g, "\t")
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, "\\");
}

function findInlineCommentIndex(value: string): number {
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] === "#" && (index === 0 || /\s/.test(value[index - 1]))) {
      return index;
    }
  }

  return -1;
}

function parseQuotedValue(
  rawValue: string,
  quote: "'" | '"',
  line: number,
  errors: DotEnvParseError[]
): string {
  let closingIndex = -1;

  for (let index = 1; index < rawValue.length; index += 1) {
    if (rawValue[index] === quote && (quote === "'" || !isEscaped(rawValue, index))) {
      closingIndex = index;
      break;
    }
  }

  if (closingIndex === -1) {
    errors.push({
      line,
      message: "quoted value is missing a closing quote"
    });
    return rawValue.slice(1);
  }

  const trailing = rawValue.slice(closingIndex + 1).trim();
  if (trailing && !trailing.startsWith("#")) {
    errors.push({
      line,
      message: "unexpected characters after quoted value"
    });
  }

  const inner = rawValue.slice(1, closingIndex);
  return quote === '"' ? decodeDoubleQuotedValue(inner) : inner;
}

function parseValue(
  rawValue: string,
  line: number,
  errors: DotEnvParseError[]
): string {
  const trimmed = rawValue.trim();

  if (!trimmed) {
    return "";
  }

  if (trimmed.startsWith('"') || trimmed.startsWith("'")) {
    return parseQuotedValue(trimmed, trimmed[0] as "'" | '"', line, errors);
  }

  const commentIndex = findInlineCommentIndex(trimmed);
  return (commentIndex === -1 ? trimmed : trimmed.slice(0, commentIndex)).trim();
}

export function parseDotEnv(content: string): DotEnvParseResult {
  const entries: DotEnvEntry[] = [];
  const errors: DotEnvParseError[] = [];
  const lines = content.replace(/^\uFEFF/, "").split(/\r?\n/);

  lines.forEach((line, index) => {
    const lineNumber = index + 1;
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith("#")) {
      return;
    }

    const assignment = trimmed.startsWith("export ")
      ? trimmed.slice("export ".length).trim()
      : trimmed;
    const separatorIndex = assignment.indexOf("=");

    if (separatorIndex === -1) {
      errors.push({
        line: lineNumber,
        message: "expected KEY=value assignment"
      });
      return;
    }

    const key = assignment.slice(0, separatorIndex).trim();
    const rawValue = assignment.slice(separatorIndex + 1);

    if (!envNamePattern.test(key)) {
      errors.push({
        line: lineNumber,
        message: `invalid env name "${key}"`
      });
      return;
    }

    entries.push({
      key,
      value: parseValue(rawValue, lineNumber, errors),
      line: lineNumber
    });
  });

  return { entries, errors };
}

export function formatDotEnvParseErrors(
  path: string,
  errors: DotEnvParseError[]
): string {
  return errors
    .map((error) => `${path}:${error.line}: ${error.message}`)
    .join("\n");
}

export async function loadDotEnv(
  options: LoadDotEnvOptions = {}
): Promise<LoadDotEnvResult> {
  const dotenvPath = resolve(options.path ?? join(options.cwd ?? projectRoot, ".env"));
  const targetEnv = options.env ?? process.env;
  let content = "";

  try {
    content = await readFile(dotenvPath, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return {
        loaded: false,
        path: dotenvPath,
        appliedKeys: [],
        skippedKeys: [],
        parsedKeys: []
      };
    }

    throw error;
  }

  const parsed = parseDotEnv(content);
  if (parsed.errors.length > 0) {
    throw new Error(formatDotEnvParseErrors(dotenvPath, parsed.errors));
  }

  const appliedKeys: string[] = [];
  const skippedKeys: string[] = [];

  for (const entry of parsed.entries) {
    if (options.override || targetEnv[entry.key] === undefined) {
      targetEnv[entry.key] = entry.value;
      appliedKeys.push(entry.key);
    } else {
      skippedKeys.push(entry.key);
    }
  }

  return {
    loaded: true,
    path: dotenvPath,
    appliedKeys,
    skippedKeys,
    parsedKeys: parsed.entries.map((entry) => entry.key)
  };
}
