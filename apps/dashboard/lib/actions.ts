import { spawn } from "node:child_process";
import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { getRepoRoot, type DashboardFsOptions } from "./paths";
import { redactSecrets } from "./redaction";

export type DashboardAction =
  | "generateBrief"
  | "continueArticle"
  | "draftDryRun"
  | "refreshLayout"
  | "finalPreflight"
  | "createWechatDraft"
  | "createFeedback"
  | "rewriteArticle"
  | "regenerateCover";

export interface ActionCommand {
  command: string;
  args: string[];
  label: string;
}

export interface ActionRunnerInput {
  command: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
}

export interface ActionRunnerResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface ExecuteDashboardActionOptions extends DashboardFsOptions {
  runner?: (input: ActionRunnerInput) => Promise<ActionRunnerResult>;
  env?: NodeJS.ProcessEnv;
}

export interface DashboardActionResult {
  action: string;
  status: "passed" | "failed" | "rejected";
  command?: string;
  exitCode?: number;
  stdout: string;
  stderr: string;
  message: string;
  startedAt: string;
  finishedAt: string;
}

export const ALLOWED_ACTIONS: Record<DashboardAction, ActionCommand> = {
  generateBrief: {
    label: "生成今日编辑简报",
    command: "pnpm",
    args: ["run:daily", "--", "--until", "brief"]
  },
  continueArticle: {
    label: "继续写文章",
    command: "pnpm",
    args: ["run:daily", "--", "--from", "article"]
  },
  draftDryRun: {
    label: "生成草稿 dry-run",
    command: "pnpm",
    args: ["wechat:draft:dry-run"]
  },
  refreshLayout: {
    label: "审核文章并刷新预览排版",
    command: "pnpm",
    args: ["run:daily", "--", "--from", "layout"]
  },
  finalPreflight: {
    label: "最终 preflight",
    command: "pnpm",
    args: ["preflight:final"]
  },
  createWechatDraft: {
    label: "写入公众号草稿箱",
    command: "pnpm",
    args: ["wechat:draft:real"]
  },
  createFeedback: {
    label: "生成反馈模板",
    command: "pnpm",
    args: ["feedback:new"]
  },
  rewriteArticle: {
    label: "AI 修改文章",
    command: "pnpm",
    args: ["article:rewrite"]
  },
  regenerateCover: {
    label: "重新生成封面",
    command: "pnpm",
    args: ["cover:regenerate"]
  }
};

const FORBIDDEN_ACTION_PATTERN =
  /(publish|freepublish|mass|sendall|群发|发布|确认发送|立即发送)/i;

export async function executeDashboardAction(
  actionName: unknown,
  options: ExecuteDashboardActionOptions = {}
): Promise<DashboardActionResult> {
  const startedAt = new Date().toISOString();
  const action = typeof actionName === "string" ? actionName : "";

  if (FORBIDDEN_ACTION_PATTERN.test(action)) {
    return rejected(action, startedAt, "Action is blocked by the publish/mass-send guard.");
  }

  const command = ALLOWED_ACTIONS[action as DashboardAction];
  if (!command) {
    return rejected(action, startedAt, "Action is not in the dashboard allowlist.");
  }

  assertCommandIsSafe(command);

  const root = getRepoRoot(options);
  const runner = options.runner ?? runSpawnedCommand;
  const env = {
    ...process.env,
    ...options.env,
    FORBID_WECHAT_PUBLISH: "true",
    FORBID_WECHAT_MASS_SEND: "true"
  };
  const displayCommand = [command.command, ...command.args].join(" ");

  const result = await runner({
    command: command.command,
    args: command.args,
    cwd: root,
    env
  });

  const finishedAt = new Date().toISOString();
  const stdout = summarizeOutput(redactSecrets(result.stdout));
  const stderr = summarizeOutput(redactSecrets(result.stderr));
  const status = result.exitCode === 0 ? "passed" : "failed";
  const response: DashboardActionResult = {
    action,
    status,
    command: displayCommand,
    exitCode: result.exitCode,
    stdout,
    stderr,
    message:
      status === "passed"
        ? `${command.label} completed.`
        : `${command.label} failed with exit code ${result.exitCode}.`,
    startedAt,
    finishedAt
  };

  await appendActionLog(root, response);
  return response;
}

function rejected(action: string, startedAt: string, message: string): DashboardActionResult {
  const finishedAt = new Date().toISOString();
  return {
    action,
    status: "rejected",
    stdout: "",
    stderr: "",
    message,
    startedAt,
    finishedAt
  };
}

function assertCommandIsSafe(command: ActionCommand): void {
  const flattened = [command.command, ...command.args].join(" ");
  if (FORBIDDEN_ACTION_PATTERN.test(flattened)) {
    throw new Error("Unsafe command detected in action allowlist.");
  }
}

async function runSpawnedCommand(input: ActionRunnerInput): Promise<ActionRunnerResult> {
  return await new Promise((resolve) => {
    const child = spawn(input.command, input.args, {
      cwd: input.cwd,
      env: input.env,
      shell: false
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout = appendBounded(stdout, chunk.toString("utf8"));
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = appendBounded(stderr, chunk.toString("utf8"));
    });
    child.on("error", (error) => {
      resolve({ exitCode: 1, stdout, stderr: `${stderr}\n${error.message}` });
    });
    child.on("close", (code) => {
      resolve({ exitCode: code ?? 1, stdout, stderr });
    });
  });
}

function appendBounded(current: string, next: string): string {
  const combined = current + next;
  return combined.length > 50000 ? combined.slice(-50000) : combined;
}

function summarizeOutput(output: string): string {
  const lines = output.trim().split(/\r?\n/).filter(Boolean);
  const summary = lines.slice(-80).join("\n");
  return summary.length > 10000 ? summary.slice(-10000) : summary;
}

async function appendActionLog(root: string, result: DashboardActionResult): Promise<void> {
  const logDir = path.join(root, "logs");
  await mkdir(logDir, { recursive: true });
  const entry = JSON.stringify(result);
  await appendFile(path.join(logDir, "dashboard-actions.log"), `${entry}\n`, "utf8");
}
