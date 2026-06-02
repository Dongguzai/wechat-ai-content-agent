import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { projectRoot } from "../src/config/env.js";

const execFileAsync = promisify(execFile);

export const cronMarkerStart = "# wechat-ai-content-agent daily auto start";
export const cronMarkerEnd = "# wechat-ai-content-agent daily auto end";
export const briefCronMarkerStart = "# wechat-ai-content-agent editorial brief start";
export const briefCronMarkerEnd = "# wechat-ai-content-agent editorial brief end";
export const defaultCronSchedule = "0 8 * * *";
export const defaultBriefCronSchedule = "0 7 * * *";

export interface ProjectCronOptions {
  root?: string;
  schedule?: string;
}

export function createProjectCronCommand(
  options: ProjectCronOptions = {}
): string {
  const root = options.root ?? projectRoot;
  return `cd ${root} && pnpm run:daily:auto >> logs/daily-auto.log 2>&1`;
}

export function createBriefCronCommand(
  options: ProjectCronOptions = {}
): string {
  const root = options.root ?? projectRoot;
  return `cd ${root} && pnpm run:daily -- --until brief >> logs/editorial-brief.log 2>&1`;
}

export function createProjectCronBlock(
  options: ProjectCronOptions = {}
): string {
  const schedule = options.schedule ?? defaultCronSchedule;
  return [
    cronMarkerStart,
    `${schedule} ${createProjectCronCommand(options)}`,
    cronMarkerEnd
  ].join("\n");
}

export function createBriefCronBlock(
  options: ProjectCronOptions = {}
): string {
  const schedule = options.schedule ?? defaultBriefCronSchedule;
  return [
    briefCronMarkerStart,
    `${schedule} ${createBriefCronCommand(options)}`,
    briefCronMarkerEnd
  ].join("\n");
}

export function removeProjectCronBlocks(cronText: string): string {
  return removeMarkedCronBlocks(cronText, cronMarkerStart, cronMarkerEnd);
}

export function removeBriefCronBlocks(cronText: string): string {
  return removeMarkedCronBlocks(cronText, briefCronMarkerStart, briefCronMarkerEnd);
}

function removeMarkedCronBlocks(
  cronText: string,
  markerStart: string,
  markerEnd: string
): string {
  const kept: string[] = [];
  let insideProjectBlock = false;

  for (const line of cronText.split(/\r?\n/)) {
    if (line.trim() === markerStart) {
      insideProjectBlock = true;
      continue;
    }

    if (line.trim() === markerEnd) {
      insideProjectBlock = false;
      continue;
    }

    if (!insideProjectBlock) {
      kept.push(line);
    }
  }

  return kept.join("\n").trimEnd();
}

export function installProjectCronText(
  cronText: string,
  options: ProjectCronOptions = {}
): string {
  const cleaned = removeProjectCronBlocks(cronText).trimEnd();
  const block = createProjectCronBlock(options);

  return cleaned ? `${cleaned}\n\n${block}\n` : `${block}\n`;
}

export function installBriefCronText(
  cronText: string,
  options: ProjectCronOptions = {}
): string {
  const cleaned = removeBriefCronBlocks(cronText).trimEnd();
  const block = createBriefCronBlock(options);

  return cleaned ? `${cleaned}\n\n${block}\n` : `${block}\n`;
}

export function showProjectCronText(
  cronText: string,
  options: ProjectCronOptions = {}
): string {
  const root = options.root ?? projectRoot;
  const lines = cronText.split(/\r?\n/);
  const matches: string[] = [];
  let insideProjectBlock = false;

  for (const line of lines) {
    if (line.trim() === cronMarkerStart || line.trim() === briefCronMarkerStart) {
      insideProjectBlock = true;
      matches.push(line);
      continue;
    }

    if (insideProjectBlock) {
      matches.push(line);
      if (line.trim() === cronMarkerEnd || line.trim() === briefCronMarkerEnd) {
        insideProjectBlock = false;
      }
      continue;
    }

    if (
      line.includes(root) &&
      (line.includes("pnpm run:daily:auto") ||
        line.includes("pnpm run:daily -- --until brief"))
    ) {
      matches.push(line);
    }
  }

  return matches.join("\n").trimEnd();
}

function isNoCrontabError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const output = `${(error as { stderr?: string }).stderr ?? ""} ${error.message}`;
  return /no crontab|no crontab for/i.test(output);
}

export async function readCurrentCrontab(): Promise<string> {
  try {
    const { stdout } = await execFileAsync("crontab", ["-l"]);
    return stdout;
  } catch (error) {
    if (isNoCrontabError(error)) {
      return "";
    }

    throw error;
  }
}

export async function writeCurrentCrontab(cronText: string): Promise<void> {
  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn("crontab", ["-"], {
      stdio: ["pipe", "ignore", "pipe"]
    });
    let stderr = "";

    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolvePromise();
        return;
      }

      reject(new Error(stderr.trim() || `crontab exited with code ${code}`));
    });
    child.stdin.end(cronText);
  });
}
