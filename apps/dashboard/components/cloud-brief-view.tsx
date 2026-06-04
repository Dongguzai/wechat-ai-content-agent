"use client";

import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, ExternalLink, RefreshCw, ShieldAlert, Star } from "lucide-react";
import { StatusBadge } from "@/components/status-badge";
import type { TodayBriefPayload } from "../../../src/types/cloud.js";

type LoadState = "loading" | "ready" | "empty" | "error";
type GenerateState = "idle" | "loading" | "success" | "failed";

interface GenerateFailure {
  step: string;
  error: string;
  hint?: string;
  endpointHint?: string;
}

interface GenerateBriefResponse {
  ok: boolean;
  status?: "already_exists" | "created";
  step?: string;
  error?: string;
  hint?: string;
  endpointHint?: string;
}

export function CloudBriefView() {
  const router = useRouter();
  const [payload, setPayload] = useState<TodayBriefPayload | null>(null);
  const [state, setState] = useState<LoadState>("loading");
  const [message, setMessage] = useState("");
  const [generateState, setGenerateState] = useState<GenerateState>("idle");
  const [generateFailure, setGenerateFailure] = useState<GenerateFailure | null>(null);

  const loadBrief = useCallback(
    async (options: { showLoading?: boolean; isCancelled?: () => boolean } = {}) => {
      const showLoading = options.showLoading ?? true;
      if (showLoading) {
        setState("loading");
      }
      setMessage("");

      try {
        const response = await fetch("/api/brief/today", {
          method: "GET",
          credentials: "same-origin"
        });

        if (response.status === 401) {
          router.replace("/login?next=/brief");
          return;
        }

        const nextPayload = (await response.json()) as TodayBriefPayload & { error?: string };

        if (options.isCancelled?.()) {
          return;
        }

        setPayload(nextPayload);

        if (!response.ok) {
          setState("error");
          setMessage(nextPayload.error ?? "今日简报读取失败。");
          return;
        }

        if (!nextPayload.brief || nextPayload.shortlistedItems.length === 0) {
          setState("empty");
          return;
        }

        setState("ready");
      } catch (error) {
        if (!options.isCancelled?.()) {
          setState("error");
          setMessage(error instanceof Error ? error.message : "今日简报读取失败。");
        }
      }
    },
    [router]
  );

  useEffect(() => {
    let cancelled = false;

    void loadBrief({ isCancelled: () => cancelled });

    return () => {
      cancelled = true;
    };
  }, [loadBrief]);

  const brief = payload?.brief ?? null;
  const items = payload?.shortlistedItems ?? [];
  const hasTodayBrief = Boolean(brief);
  const generateButtonLabel = buttonLabel(generateState, hasTodayBrief);

  async function generateBrief() {
    const force = hasTodayBrief;

    if (
      force &&
      !window.confirm("今天已经生成过简报，重新收集会覆盖今日入围资讯，是否继续？")
    ) {
      return;
    }

    setGenerateState("loading");
    setGenerateFailure(null);

    try {
      const response = await fetch("/api/brief/generate", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(force ? { force: true } : {})
      });

      if (response.status === 401) {
        router.replace("/login?next=/brief");
        return;
      }

      const result = (await response.json()) as GenerateBriefResponse;

      if (!response.ok || !result.ok) {
        setGenerateState("failed");
        setGenerateFailure({
          step: result.step ?? "unknown",
          error: result.error ?? "Brief generation failed.",
          hint: result.hint,
          endpointHint: result.endpointHint
        });
        return;
      }

      setGenerateState("success");
      await loadBrief({ showLoading: false });
    } catch (error) {
      setGenerateState("failed");
      setGenerateFailure({
        step: "request",
        error: error instanceof Error ? error.message : "Brief generation failed."
      });
    }
  }

  return (
    <div className="space-y-5">
      <section className="border-b border-line bg-white px-5 py-5">
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-xs font-semibold text-stone-500">每日第一入口</p>
            <h2 className="mt-2 text-2xl font-bold text-ink">今日 10 条入围资讯阅读清单</h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-stone-600">
              AI 推荐主选题：{brief?.recommendedTitle ?? "暂无"}。本页数据来自 Neon，不读取本地 outputs。
            </p>
          </div>
          <div className="flex flex-col items-start gap-3 md:items-end">
            <button
              type="button"
              onClick={generateBrief}
              disabled={generateState === "loading"}
              className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-ink bg-ink px-4 py-2 text-sm font-semibold text-white transition hover:bg-stone-800 disabled:cursor-wait disabled:opacity-60"
              title={hasTodayBrief ? "重新收集今日编辑简报" : "开始收集今日编辑简报"}
            >
              <RefreshCw className={`size-4 ${generateState === "loading" ? "animate-spin" : ""}`} aria-hidden="true" />
              {generateButtonLabel}
            </button>
            <StatusBadge
              state={state === "ready" && items.length === 10 ? "passed" : state === "error" ? "failed" : "waiting"}
            />
          </div>
        </div>
      </section>

      {generateState === "loading" ? (
        <StatePanel
          icon={<RefreshCw className="size-4 animate-spin" aria-hidden="true" />}
          title="正在收集..."
          description="正在抓取资讯并筛选 10 条入围内容，通常需要 30～60 秒。"
        />
      ) : null}

      {generateState === "success" ? (
        <StatePanel
          icon={<CheckCircle2 className="size-4" aria-hidden="true" />}
          title="收集完成"
        />
      ) : null}

      {generateState === "failed" ? (
        <StatePanel
          icon={<ShieldAlert className="size-4" aria-hidden="true" />}
          title="收集失败"
        >
          <div className="mt-3 grid gap-2 text-xs font-medium text-stone-600 md:grid-cols-2">
            <p>失败阶段：{generateFailure?.step ?? "unknown"}</p>
            <p className="break-words md:col-span-2">错误摘要：{generateFailure?.error ?? "Brief generation failed."}</p>
            {generateFailure?.hint ? (
              <p className="break-words md:col-span-2">排查提示：{generateFailure.hint}</p>
            ) : null}
            {generateFailure?.endpointHint ? (
              <p className="break-words md:col-span-2">Endpoint：{generateFailure.endpointHint}</p>
            ) : null}
          </div>
        </StatePanel>
      ) : null}

      {state === "loading" && generateState !== "loading" ? (
        <StatePanel icon={<RefreshCw className="size-4 animate-spin" aria-hidden="true" />} title="正在读取今日简报" />
      ) : null}

      {state === "empty" && generateState !== "loading" ? (
        <StatePanel
          icon={<ShieldAlert className="size-4" aria-hidden="true" />}
          title="今日简报尚未生成。请等待 7 点定时任务，或手动触发生成。"
        />
      ) : null}

      {state === "error" && generateState !== "loading" ? (
        <StatePanel
          icon={<ShieldAlert className="size-4" aria-hidden="true" />}
          title={message || "今日简报读取失败。"}
        />
      ) : null}

      {brief ? (
        <section className="border border-line bg-white p-5">
          <div className="flex items-start gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-ink text-white">
              <Star className="size-4" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <p className="text-xs font-semibold text-stone-500">AI 推荐主选题</p>
              <h3 className="mt-1 text-lg font-bold leading-7 text-ink">{brief.recommendedTitle}</h3>
              <a
                href={brief.recommendedUrl}
                target="_blank"
                rel="noreferrer"
                className="mt-2 inline-flex max-w-full items-center gap-2 break-all text-sm font-semibold text-stone-700 hover:text-ink"
              >
                <ExternalLink className="size-4 shrink-0" aria-hidden="true" />
                {brief.recommendedUrl}
              </a>
              <dl className="mt-4 grid gap-3 text-sm md:grid-cols-2">
                <Info label="推荐理由" value={brief.recommendationReason} wide />
                <Info label="核心冲突" value={brief.coreConflict} />
                <Info label="来源可靠性" value={brief.sourceReliability} />
                <Info label="写作角度" value={brief.writingAngle} wide />
                <Info label="中心论点" value={brief.articleThesis} wide />
                <Info
                  label="风险提醒"
                  value={brief.riskNotes.length ? brief.riskNotes.join("；") : "无"}
                  wide
                />
              </dl>
            </div>
          </div>
        </section>
      ) : null}

      {items.slice(0, 10).map((item) => (
        <article key={item.id} className="border border-line bg-white p-5">
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div className="min-w-0">
              <p className="text-xs font-semibold text-stone-500">#{item.rank}</p>
              <h3 className="mt-1 text-base font-bold leading-6 text-ink">{item.title}</h3>
              <p className="mt-2 text-sm text-stone-600">{sourceLabel(item)}</p>
            </div>
            <a
              href={item.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex shrink-0 items-center justify-center gap-2 rounded-md border border-line px-3 py-2 text-sm font-semibold text-stone-700 hover:border-ink hover:text-ink"
            >
              <ExternalLink className="size-4" aria-hidden="true" />
              阅读原文
            </a>
          </div>
          <dl className="mt-4 grid gap-3 text-sm md:grid-cols-2">
            <Info label="score" value={String(item.shortlistScore)} />
            <Info label="category / tags" value={[item.category, item.tags.join(", ")].filter(Boolean).join(" / ")} />
            <Info label="topicAngle" value={item.topicAngle} wide />
            <Info label="shortlistReason" value={item.shortlistReason} wide />
            <Info label="riskNotes" value={item.riskNotes.length ? item.riskNotes.join("；") : "无"} wide />
          </dl>
        </article>
      ))}
    </div>
  );
}

function StatePanel({
  icon,
  title,
  description,
  children
}: {
  icon: ReactNode;
  title: string;
  description?: string;
  children?: ReactNode;
}) {
  return (
    <section className="flex items-start gap-3 border border-line bg-white p-5 text-sm font-semibold text-stone-700">
      {icon}
      <div className="min-w-0">
        <p>{title}</p>
        {description ? <p className="mt-2 font-normal leading-6 text-stone-600">{description}</p> : null}
        {children}
      </div>
    </section>
  );
}

function Info({
  label,
  value,
  wide
}: {
  label: string;
  value: string;
  wide?: boolean;
}) {
  return (
    <div className={wide ? "md:col-span-2" : undefined}>
      <dt className="text-xs font-semibold text-stone-500">{label}</dt>
      <dd className="mt-1 leading-6 text-stone-700">{value || "无"}</dd>
    </div>
  );
}

function sourceLabel(item: { sourceName: string; sourceType: string; provider?: string; query?: string }): string {
  const provider = item.provider ? ` / ${item.provider}` : "";
  const query = item.query ? ` / ${item.query}` : "";
  return `${item.sourceName} / ${item.sourceType}${provider}${query}`;
}

function buttonLabel(state: GenerateState, hasTodayBrief: boolean): string {
  if (state === "loading") {
    return "正在收集...";
  }
  if (state === "success") {
    return "收集完成";
  }
  if (state === "failed") {
    return "收集失败";
  }
  return hasTodayBrief ? "重新收集" : "开始收集";
}
