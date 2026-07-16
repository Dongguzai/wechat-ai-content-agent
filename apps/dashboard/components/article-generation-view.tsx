"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  Clock3,
  FileText,
  Loader2,
  RefreshCw,
  XCircle
} from "lucide-react";
import type {
  ArticleGenerationStage,
  ArticleGenerationStepRecord,
  ArticleGenerationTaskRecord
} from "../../../src/types/cloud";

type LoadState = "loading" | "ready" | "missing" | "error";

interface StatusResponse {
  ok: boolean;
  task?: ArticleGenerationTaskRecord;
  steps?: SafeArticleGenerationStep[];
  error?: string;
}

interface CancelResponse {
  ok: boolean;
  task?: ArticleGenerationTaskRecord;
  error?: string;
}

const statusLabels: Record<ArticleGenerationTaskRecord["status"], string> = {
  queued: "等待生成",
  running: "正在生成",
  success: "文章已生成",
  failed: "生成失败",
  cancelled: "任务已取消"
};

const stageLabels: Record<ArticleGenerationTaskRecord["currentStage"], string> = {
  waiting_for_worker: "等待 Worker",
  topic_analysis: "选题分析",
  research: "调研验证",
  fact_pack: "事实包整理",
  outline: "文章结构规划",
  writing: "正文生成",
  title: "标题优化",
  review: "文章审核",
  completed: "已完成"
};

const terminalStatuses = new Set<ArticleGenerationTaskRecord["status"]>([
  "success",
  "failed",
  "cancelled"
]);

type SafeArticleGenerationStep = Omit<ArticleGenerationStepRecord, "inputJson" | "outputJson">;
type VisibleStageKey = "selection_confirmed" | Exclude<ArticleGenerationStage, "waiting_for_worker" | "completed">;
type VisibleStageState = "success" | "running" | "waiting_next" | "failed" | "cancelled" | "pending";

const visibleStages: Array<{ key: VisibleStageKey; label: string }> = [
  { key: "selection_confirmed", label: "选题确认" },
  { key: "topic_analysis", label: "选题分析" },
  { key: "research", label: "调研验证" },
  { key: "fact_pack", label: "FactPack" },
  { key: "outline", label: "文章结构" },
  { key: "writing", label: "正文生成" },
  { key: "title", label: "标题优化" },
  { key: "review", label: "内容审核" }
];

const visibleStageOrder = visibleStages.map((stage) => stage.key);

export function ArticleGenerationView({ taskId }: { taskId: string }) {
  const router = useRouter();
  const [state, setState] = useState<LoadState>("loading");
  const [task, setTask] = useState<ArticleGenerationTaskRecord | null>(null);
  const [steps, setSteps] = useState<SafeArticleGenerationStep[]>([]);
  const [error, setError] = useState("");
  const [isCancelling, setIsCancelling] = useState(false);
  const [successRedirectCountdown, setSuccessRedirectCountdown] = useState(3);

  const loadTask = useCallback(async () => {
    setError("");
    try {
      const response = await fetch(`/api/article-generation/status?id=${encodeURIComponent(taskId)}`, {
        method: "GET",
        credentials: "same-origin"
      });

      if (response.status === 401) {
        router.replace(`/login?next=${encodeURIComponent(`/article-generation/${taskId}`)}`);
        return;
      }

      const result = (await response.json()) as StatusResponse;
      if (response.status === 404) {
        setState("missing");
        setTask(null);
        setError(result.error ?? "任务不存在。");
        return;
      }
      if (!response.ok || !result.ok || !result.task) {
        setState("error");
        setError(result.error ?? "任务状态读取失败。");
        return;
      }

      setTask(result.task);
      setSteps(result.steps ?? []);
      setState("ready");
    } catch (nextError) {
      setState("error");
      setError(nextError instanceof Error ? nextError.message : "任务状态读取失败。");
    }
  }, [router, taskId]);

  useEffect(() => {
    void loadTask();
  }, [loadTask]);

  useEffect(() => {
    if (!task || terminalStatuses.has(task.status)) {
      return;
    }

    const timer = window.setInterval(() => {
      void loadTask();
    }, 3000);

    return () => window.clearInterval(timer);
  }, [loadTask, task]);

  useEffect(() => {
    if (task?.status !== "success") {
      return;
    }

    setSuccessRedirectCountdown(3);
    const timer = window.setInterval(() => {
      setSuccessRedirectCountdown((value) => {
        if (value <= 1) {
          window.clearInterval(timer);
          router.push("/article");
          return 0;
        }
        return value - 1;
      });
    }, 1000);

    return () => window.clearInterval(timer);
  }, [router, task?.status]);

  async function cancelTask() {
    if (!task || (task.status !== "queued" && task.status !== "running")) {
      return;
    }
    if (!window.confirm("确认取消这次文章生成任务吗？")) {
      return;
    }

    setIsCancelling(true);
    setError("");
    try {
      const response = await fetch("/api/article-generation/cancel", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ taskId })
      });

      if (response.status === 401) {
        router.replace(`/login?next=${encodeURIComponent(`/article-generation/${taskId}`)}`);
        return;
      }

      const result = (await response.json()) as CancelResponse;
      if (!response.ok || !result.ok || !result.task) {
        setError(result.error ?? "任务取消失败。");
        return;
      }

      setTask(result.task);
      if (result.task.status === "cancelled") {
        setSteps((current) => current);
      }
      setState("ready");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "任务取消失败。");
    } finally {
      setIsCancelling(false);
    }
  }

  const progress = Math.max(0, Math.min(100, task?.progress ?? 0));
  const shell = useMemo(() => {
    if (state === "loading") {
      return {
        icon: <Loader2 className="size-5 animate-spin" aria-hidden="true" />,
        title: "正在准备文章",
        status: "正在读取任务状态",
        tone: "waiting"
      };
    }
    if (state === "missing") {
      return {
        icon: <AlertTriangle className="size-5" aria-hidden="true" />,
        title: "正在准备文章",
        status: "任务不存在",
        tone: "failed"
      };
    }
    if (state === "error") {
      return {
        icon: <XCircle className="size-5" aria-hidden="true" />,
        title: "正在准备文章",
        status: "读取失败",
        tone: "failed"
      };
    }
    return presentationFor(task?.status ?? "queued");
  }, [state, task?.status]);

  return (
    <div className="space-y-5">
      <section className="border-b border-line bg-white px-5 py-5">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-xs font-semibold text-stone-500">Article Generation Task</p>
            <h2 className="mt-2 text-2xl font-bold text-ink">正在准备文章</h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-stone-600">
              任务状态来自 Neon。Phase 1 只创建任务并等待后续 Worker，不会在页面内触发生成流程。
            </p>
          </div>
          <div className={`inline-flex items-center gap-2 border px-3 py-2 text-sm font-semibold ${toneClass(shell.tone)}`}>
            {shell.icon}
            {shell.status}
          </div>
        </div>
      </section>

      <section className="border border-line bg-white p-5">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold text-stone-500">当前选题</p>
            <h3 className="mt-2 text-xl font-bold leading-8 text-ink">
              {task?.approvedTitle ?? "正在读取选题标题"}
            </h3>
            <dl className="mt-5 grid gap-3 text-sm md:grid-cols-2">
              <Info label="任务 ID" value={taskId} />
              <Info label="任务状态" value={task ? statusLabels[task.status] : shell.status} />
              <Info label="当前阶段" value={task ? stageLabels[task.currentStage] : "正在读取"} />
              <Info label="更新时间" value={formatDate(task?.updatedAt)} />
            </dl>
          </div>
          <div className="w-full border border-line bg-paper p-4 lg:w-80">
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm font-semibold text-stone-600">当前进度</span>
              <span className="text-lg font-bold text-ink">{progress}%</span>
            </div>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-stone-200">
              <div className="h-full bg-ink transition-all" style={{ width: `${progress}%` }} />
            </div>
            <p className="mt-4 text-sm leading-6 text-stone-700">
              {task?.message ?? "正在读取任务状态。"}
            </p>
          </div>
        </div>
      </section>

      {task?.status === "queued" ? (
        <StatePanel
          icon={<Clock3 className="size-4" aria-hidden="true" />}
          title={
            task.currentStage === "research"
              ? "等待下一阶段"
              : "文章生成任务已经创建。AI Agent 将自动执行内容生产流程。你可以关闭页面，稍后回来查看。"
          }
        />
      ) : null}

      {task ? <StageProgress task={task} steps={steps} /> : null}

      {task?.status === "success" ? (
        <StatePanel
          icon={<CheckCircle2 className="size-4" aria-hidden="true" />}
          title={`文章已生成，${successRedirectCountdown} 秒后进入文章编辑页。`}
        >
          <LinkButton href="/article" label="立即查看文章" icon={<FileText className="size-4" aria-hidden="true" />} />
        </StatePanel>
      ) : null}

      {task?.status === "failed" ? (
        <StatePanel icon={<AlertTriangle className="size-4" aria-hidden="true" />} title="生成失败">
          <p className="mt-2 break-words text-sm font-medium text-stone-700">
            {task.errorMessage ?? "任务失败，但没有返回错误摘要。"}
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <LinkButton href="/brief" label="返回今日选题" />
            <button
              type="button"
              disabled
              className="inline-flex min-h-10 items-center justify-center rounded-md border border-line bg-stone-100 px-3 py-2 text-sm font-semibold text-stone-500"
            >
              重新生成将在下一阶段开放
            </button>
          </div>
        </StatePanel>
      ) : null}

      {task?.status === "cancelled" ? (
        <StatePanel icon={<Ban className="size-4" aria-hidden="true" />} title="任务已取消">
          <div className="mt-4">
            <LinkButton href="/brief" label="返回今日选题" />
          </div>
        </StatePanel>
      ) : null}

      {state === "missing" || state === "error" || error ? (
        <StatePanel icon={<AlertTriangle className="size-4" aria-hidden="true" />} title={error || "任务状态不可用"}>
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void loadTask()}
              className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-ink bg-ink px-3 py-2 text-sm font-semibold text-white transition hover:bg-stone-800"
            >
              <RefreshCw className="size-4" aria-hidden="true" />
              重新读取
            </button>
            <LinkButton href="/brief" label="返回今日选题" />
          </div>
        </StatePanel>
      ) : null}

      {task?.status === "queued" || task?.status === "running" ? (
        <section className="border border-line bg-white p-5">
          <button
            type="button"
            onClick={cancelTask}
            disabled={isCancelling}
            className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700 transition hover:border-red-300 hover:bg-red-100 disabled:cursor-wait disabled:opacity-60"
          >
            {isCancelling ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <XCircle className="size-4" aria-hidden="true" />
            )}
            取消生成
          </button>
        </section>
      ) : null}
    </div>
  );
}

function presentationFor(status: ArticleGenerationTaskRecord["status"]) {
  if (status === "success") {
    return {
      icon: <CheckCircle2 className="size-5" aria-hidden="true" />,
      title: "正在准备文章",
      status: statusLabels.success,
      tone: "passed"
    };
  }
  if (status === "failed") {
    return {
      icon: <AlertTriangle className="size-5" aria-hidden="true" />,
      title: "正在准备文章",
      status: statusLabels.failed,
      tone: "failed"
    };
  }
  if (status === "cancelled") {
    return {
      icon: <Ban className="size-5" aria-hidden="true" />,
      title: "正在准备文章",
      status: statusLabels.cancelled,
      tone: "missing"
    };
  }
  return {
    icon: <Clock3 className="size-5" aria-hidden="true" />,
    title: "正在准备文章",
    status: statusLabels[status],
    tone: "waiting"
  };
}

function StageProgress({
  task,
  steps
}: {
  task: ArticleGenerationTaskRecord;
  steps: SafeArticleGenerationStep[];
}) {
  const stepByStage = new Map(steps.map((step) => [step.stage, step]));
  const failedStep = steps.find((step) => step.status === "failed");

  return (
    <section className="border border-line bg-white p-5">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-bold text-ink">阶段进度</h3>
        {failedStep ? (
          <span className="text-xs font-semibold text-red-700">失败阶段：{stageLabels[failedStep.stage]}</span>
        ) : null}
      </div>
      <ol className="mt-4 grid gap-2 md:grid-cols-2">
        {visibleStages.map((stage) => {
          const step = stage.key === "selection_confirmed" ? undefined : stepByStage.get(stage.key);
          const state = stageState(task, stage.key, step);
          return (
            <li key={stage.key} className="flex items-center gap-3 border border-line bg-paper px-3 py-3">
              <span className={`flex size-7 shrink-0 items-center justify-center rounded-md ${stageIconClass(state)}`}>
                {stageIcon(state)}
              </span>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-ink">{stage.label}</p>
                <p className="mt-0.5 text-xs font-medium text-stone-500">{stageStateLabel(state)}</p>
                {state === "failed" && step?.errorMessage ? (
                  <p className="mt-1 break-words text-xs font-medium text-red-700">{step.errorMessage}</p>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function stageState(
  task: ArticleGenerationTaskRecord,
  stage: VisibleStageKey,
  step: SafeArticleGenerationStep | undefined
): VisibleStageState {
  if (stage === "selection_confirmed") {
    return task.status === "cancelled" ? "cancelled" : "success";
  }
  if (step?.status === "success") return "success";
  if (step?.status === "failed") return "failed";
  if (step?.status === "cancelled") return "cancelled";
  if (task.status === "failed" && task.currentStage === stage) return "failed";
  if (task.status === "cancelled" && task.currentStage === stage) return "cancelled";
  if (task.currentStage === stage && task.status === "running") return "running";
  if (task.currentStage === stage && task.status === "queued" && stage !== "topic_analysis") return "waiting_next";

  const currentIndex = visibleStageOrder.indexOf(task.currentStage as VisibleStageKey);
  const stageIndex = visibleStageOrder.indexOf(stage);
  if (currentIndex > stageIndex && stageIndex > -1) return "success";

  return "pending";
}

function stageStateLabel(state: VisibleStageState): string {
  if (state === "success") return "已完成";
  if (state === "running") return "进行中";
  if (state === "waiting_next") return "等待下一阶段";
  if (state === "failed") return "失败";
  if (state === "cancelled") return "已取消";
  return "尚未开始";
}

function stageIcon(state: VisibleStageState): ReactNode {
  if (state === "success") return <CheckCircle2 className="size-4" aria-hidden="true" />;
  if (state === "running") return <Loader2 className="size-4 animate-spin" aria-hidden="true" />;
  if (state === "failed") return <AlertTriangle className="size-4" aria-hidden="true" />;
  if (state === "cancelled") return <Ban className="size-4" aria-hidden="true" />;
  return <Clock3 className="size-4" aria-hidden="true" />;
}

function stageIconClass(state: VisibleStageState): string {
  if (state === "success") return "bg-emerald-600 text-white";
  if (state === "running") return "bg-ink text-white";
  if (state === "waiting_next") return "bg-amber-100 text-amber-800";
  if (state === "failed") return "bg-red-100 text-red-700";
  if (state === "cancelled") return "bg-stone-200 text-stone-600";
  return "bg-stone-200 text-stone-500";
}

function toneClass(tone: string): string {
  if (tone === "passed") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (tone === "failed") return "border-red-200 bg-red-50 text-red-700";
  if (tone === "missing") return "border-stone-200 bg-stone-100 text-stone-600";
  return "border-amber-200 bg-amber-50 text-amber-800";
}

function formatDate(value: string | undefined): string {
  if (!value) return "正在读取";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", { hour12: false });
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-line bg-paper px-3 py-2">
      <dt className="text-xs font-semibold text-stone-500">{label}</dt>
      <dd className="mt-1 break-words font-semibold text-stone-800">{value}</dd>
    </div>
  );
}

function StatePanel({
  icon,
  title,
  children
}: {
  icon: ReactNode;
  title: string;
  children?: ReactNode;
}) {
  return (
    <section className="border border-line bg-white p-5">
      <div className="flex items-start gap-3">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-ink text-white">
          {icon}
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold leading-6 text-ink">{title}</p>
          {children}
        </div>
      </div>
    </section>
  );
}

function LinkButton({
  href,
  label,
  icon
}: {
  href: string;
  label: string;
  icon?: ReactNode;
}) {
  return (
    <Link
      href={href}
      className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-ink bg-ink px-3 py-2 text-sm font-semibold text-white transition hover:bg-stone-800"
    >
      {icon}
      {label}
    </Link>
  );
}
