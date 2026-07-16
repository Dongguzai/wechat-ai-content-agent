"use client";

import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Check, CheckCircle2, ExternalLink, RefreshCw, ShieldAlert, Star } from "lucide-react";
import { StatusBadge } from "@/components/status-badge";
import type { TodayBriefPayload } from "../../../src/types/cloud.js";

type LoadState = "loading" | "ready" | "empty" | "error";
type GenerateState = "idle" | "loading" | "success" | "failed";
type SelectionStage = "idle" | "saving" | "generating";
type ShortlistedItem = TodayBriefPayload["shortlistedItems"][number];

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

interface SelectTopicResponse {
  ok: boolean;
  path?: string;
  persistence?: "local-file" | "neon";
  redirectTo?: string;
  taskId?: string;
  taskStatus?: "queued" | "running" | "success" | "failed" | "cancelled";
  error?: string;
}

interface DashboardActionResponse {
  status?: "passed" | "failed" | "rejected";
  message?: string;
  error?: string;
}

interface CachedBriefState {
  cachedAt: string;
  runDate?: string;
  payload: TodayBriefPayload;
}

interface CachedBriefSelection {
  cachedAt: string;
  runDate?: string;
  topicId: string;
}

const BRIEF_CACHE_KEY = "wechat-ai-content-agent:cloud-brief:v1";
const BRIEF_SELECTION_CACHE_KEY = "wechat-ai-content-agent:cloud-brief-selection:v1";
const BRIEF_CACHE_MAX_AGE_MS = 20 * 60 * 60 * 1000;

export function CloudBriefView() {
  const router = useRouter();
  const [payload, setPayload] = useState<TodayBriefPayload | null>(null);
  const [state, setState] = useState<LoadState>("loading");
  const [message, setMessage] = useState("");
  const [generateState, setGenerateState] = useState<GenerateState>("idle");
  const [generateFailure, setGenerateFailure] = useState<GenerateFailure | null>(null);
  const [selectedTopicId, setSelectedTopicId] = useState("");
  const [selectingTopicId, setSelectingTopicId] = useState("");
  const [selectionStage, setSelectionStage] = useState<SelectionStage>("idle");
  const [selectionMessage, setSelectionMessage] = useState("");
  const [selectionError, setSelectionError] = useState("");
  const [selectionErrorTopicId, setSelectionErrorTopicId] = useState("");

  const applyBriefPayload = useCallback((nextPayload: TodayBriefPayload) => {
    setPayload(nextPayload);

    if (!nextPayload.brief || nextPayload.shortlistedItems.length === 0) {
      setState("empty");
      return;
    }

    setState("ready");
  }, []);

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

        if (!response.ok) {
          setState("error");
          setMessage(nextPayload.error ?? "今日简报读取失败。");
          return;
        }

        applyBriefPayload(nextPayload);
        writeBriefCache(nextPayload);
        setSelectedTopicId(readBriefSelection(nextPayload));
      } catch (error) {
        if (!options.isCancelled?.()) {
          setState("error");
          setMessage(error instanceof Error ? error.message : "今日简报读取失败。");
        }
      }
    },
    [applyBriefPayload, router]
  );

  useEffect(() => {
    let cancelled = false;
    const cachedPayload = readBriefCache();

    if (cachedPayload) {
      applyBriefPayload(cachedPayload);
      setSelectedTopicId(readBriefSelection(cachedPayload));
      return () => {
        cancelled = true;
      };
    }

    void loadBrief({ isCancelled: () => cancelled });

    return () => {
      cancelled = true;
    };
  }, [applyBriefPayload, loadBrief]);

  const brief = payload?.brief ?? null;
  const items = payload?.shortlistedItems ?? [];
  const hasTodayBrief = Boolean(brief);
  const generateButtonLabel = buttonLabel(generateState, hasTodayBrief);
  const readingBrief = state === "loading" && generateState !== "loading";

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

  async function selectTopic(item: ShortlistedItem) {
    const title = item.titleZh ?? item.title;

    if (!item.id || !item.url || !title) {
      setSelectionError("这条资讯缺少 id、标题或原文 URL，不能作为今日主选题。");
      setSelectionMessage("");
      return;
    }

    setSelectingTopicId(item.id);
    setSelectionStage("saving");
    setSelectionMessage("");
    setSelectionError("");
    setSelectionErrorTopicId("");

    try {
      const response = await fetch("/api/brief/select-topic", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          source: "cloud-brief",
          runId: item.runId,
          topicId: item.id,
          topic: topicSnapshot(item),
          shortlistedItems: items.slice(0, 10).map(topicSnapshot)
        })
      });

      if (response.status === 401) {
        router.replace("/login?next=/brief");
        return;
      }

      const result = (await response.json()) as SelectTopicResponse;

      if (!response.ok || !result.ok) {
        setSelectionError(result.error ?? "选题保存失败。");
        setSelectionErrorTopicId(item.id);
        return;
      }

      setSelectedTopicId(item.id);
      writeBriefSelection(item.id, payload);

      if (result.persistence === "neon") {
        if (!result.taskId) {
          setSelectionError("选题已保存，但文章任务创建失败，请重新读取页面后重试。");
          setSelectionErrorTopicId(item.id);
          return;
        }

        setSelectionMessage(`任务已创建，正在进入生成页面...`);
        router.push(result.redirectTo ?? `/article-generation/${result.taskId}`);
        return;
      }

      setSelectionStage("generating");
      setSelectionMessage(`已选择「${title}」，正在生成文章。`);

      const actionResponse = await fetch("/api/action", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "continueArticle" })
      });

      if (actionResponse.status === 401) {
        router.replace("/login?next=/brief");
        return;
      }

      const actionResult = (await actionResponse.json()) as DashboardActionResponse;
      if (!actionResponse.ok || actionResult.status !== "passed") {
        setSelectionError(
          `选题已保存，但文章生成失败：${actionResult.message ?? actionResult.error ?? "请检查 Dashboard action 日志。"}`
        );
        setSelectionErrorTopicId(item.id);
        return;
      }

      setSelectionMessage(`文章已生成，正在进入「${title}」的编辑页。`);
      router.push(result.redirectTo ?? "/article");
    } catch (error) {
      setSelectionError(error instanceof Error ? error.message : "选题保存失败。");
      setSelectionErrorTopicId(item.id);
    } finally {
      setSelectingTopicId("");
      setSelectionStage("idle");
    }
  }

  async function refreshBrief() {
    await loadBrief();
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
            <div className="flex flex-wrap items-center gap-2 md:justify-end">
              <button
                type="button"
                onClick={refreshBrief}
                disabled={readingBrief || generateState === "loading"}
                className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-line bg-white px-3 py-2 text-sm font-semibold text-stone-700 transition hover:border-ink hover:text-ink disabled:cursor-wait disabled:opacity-60"
                title="重新读取云端今日简报"
              >
                <RefreshCw className={`size-4 ${readingBrief ? "animate-spin" : ""}`} aria-hidden="true" />
                {readingBrief ? "读取中..." : "刷新云端"}
              </button>
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
            </div>
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

      {selectionMessage ? (
        <StatePanel
          icon={<CheckCircle2 className="size-4" aria-hidden="true" />}
          title={selectionMessage}
        />
      ) : null}

      {selectionError ? (
        <StatePanel
          icon={<ShieldAlert className="size-4" aria-hidden="true" />}
          title="选题保存失败"
        >
          <p className="mt-2 break-words text-sm font-medium text-stone-700">{selectionError}</p>
        </StatePanel>
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

      {items.slice(0, 10).map((item) => {
        const title = item.titleZh ?? item.title;
        const rawTitle = item.rawTitle ?? "";
        const summary = item.summaryZh ?? item.summary;
        const topicAngle = item.topicAngleZh ?? item.topicAngle;
        const shortlistReason = item.shortlistReasonZh ?? item.shortlistReason;
        const riskNotes = item.riskNotesZh?.length ? item.riskNotesZh : item.riskNotes;
        const isSelected = selectedTopicId === item.id;
        const isSelecting = selectingTopicId === item.id;
        const hasSelectionError = selectionErrorTopicId === item.id;
        const canSelect = Boolean(item.id && item.url && title);

        return (
          <article key={item.id} className="border border-line bg-white p-5">
            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div className="min-w-0">
                <p className="text-xs font-semibold text-stone-500">#{item.rank}</p>
                <h3 className="mt-1 text-base font-bold leading-6 text-ink">{title}</h3>
                {rawTitle && rawTitle !== title ? (
                  <p className="mt-2 text-sm leading-6 text-stone-600">原始标题：{rawTitle}</p>
                ) : null}
                <p className="mt-2 break-all text-sm text-stone-600">原文 URL：{item.url}</p>
                <p className="mt-2 text-sm text-stone-600">{sourceLabel(item)}</p>
              </div>
              <div className="flex shrink-0 flex-wrap gap-2 md:flex-col">
                <a
                  href={item.url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-line px-3 py-2 text-sm font-semibold text-stone-700 hover:border-ink hover:text-ink"
                >
                  <ExternalLink className="size-4" aria-hidden="true" />
                  阅读原文
                </a>
                <button
                  type="button"
                  onClick={() => selectTopic(item)}
                  disabled={Boolean(selectingTopicId) || !canSelect}
                  className={`inline-flex min-h-10 items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-60 ${
                    isSelected
                      ? "border border-emerald-200 bg-emerald-50 text-emerald-700"
                      : "border border-ink bg-ink text-white hover:bg-stone-800"
                  }`}
                  title="选择为今日主选题"
                >
                  {isSelected ? (
                    <CheckCircle2 className="size-4" aria-hidden="true" />
                  ) : (
                    <Check className="size-4" aria-hidden="true" />
                  )}
                  {isSelecting
                    ? selectionStage === "generating"
                      ? "生成文章..."
                      : "正在确认选题..."
                    : isSelected
                      ? "已选择"
                      : "选择此题"}
                </button>
              </div>
            </div>
            <dl className="mt-4 grid gap-3 text-sm md:grid-cols-2">
              <Info label="score" value={String(item.shortlistScore)} />
              <Info label="category / tags" value={[item.category, item.tags.join(", ")].filter(Boolean).join(" / ")} />
              <Info label="中文摘要" value={summary} wide />
              <Info label="中文选题角度" value={topicAngle} wide />
              <Info label="中文入围理由" value={shortlistReason} wide />
              <Info label="风险提醒" value={riskNotes.length ? riskNotes.join("；") : "无"} wide />
            </dl>
            {isSelecting ? (
              <p className="mt-3 text-xs font-semibold text-stone-600">
                {selectionStage === "generating" ? "正在生成文章产物，请稍候。" : "正在确认选题。"}
              </p>
            ) : null}
            {isSelected && !isSelecting && !hasSelectionError ? (
              <p className="mt-3 text-xs font-semibold text-emerald-700">
                已保存选题确认。
              </p>
            ) : null}
            {hasSelectionError ? (
              <p className="mt-3 break-words text-xs font-semibold text-oxblood">
                {selectionError}
              </p>
            ) : null}
          </article>
        );
      })}
    </div>
  );
}

function topicSnapshot(item: ShortlistedItem) {
  return {
    id: item.id,
    runId: item.runId,
    newsItemId: item.newsItemId,
    rank: item.rank,
    title: item.title,
    rawTitle: item.rawTitle,
    titleZh: item.titleZh,
    url: item.url,
    sourceName: item.sourceName,
    sourceType: item.sourceType,
    provider: item.provider,
    query: item.query,
    category: item.category,
    tags: item.tags,
    summary: item.summary,
    rawSummary: item.rawSummary,
    summaryZh: item.summaryZh,
    topicAngle: item.topicAngle,
    topicAngleZh: item.topicAngleZh,
    shortlistReason: item.shortlistReason,
    shortlistReasonZh: item.shortlistReasonZh,
    shortlistScore: item.shortlistScore,
    riskNotes: item.riskNotes,
    riskNotesZh: item.riskNotesZh,
    sourceLanguage: item.sourceLanguage,
    localized: item.localized,
    createdAt: item.createdAt
  };
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

function readBriefCache(): TodayBriefPayload | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const raw = window.sessionStorage.getItem(BRIEF_CACHE_KEY);
    const cached = raw ? (JSON.parse(raw) as unknown) : null;

    if (!isCachedBriefState(cached) || isExpired(cached.cachedAt)) {
      window.sessionStorage.removeItem(BRIEF_CACHE_KEY);
      return null;
    }

    const runDate = cached.runDate ?? cached.payload.run?.runDate;
    if (runDate && runDate !== todayRunDate()) {
      window.sessionStorage.removeItem(BRIEF_CACHE_KEY);
      return null;
    }

    return usableBriefPayload(cached.payload) ? cached.payload : null;
  } catch {
    return null;
  }
}

function writeBriefCache(payload: TodayBriefPayload): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    if (!usableBriefPayload(payload)) {
      window.sessionStorage.removeItem(BRIEF_CACHE_KEY);
      return;
    }

    const cached: CachedBriefState = {
      cachedAt: new Date().toISOString(),
      runDate: payload.run?.runDate,
      payload
    };

    window.sessionStorage.setItem(BRIEF_CACHE_KEY, JSON.stringify(cached));
  } catch {
    // sessionStorage can be unavailable in hardened browser modes.
  }
}

function readBriefSelection(payload: TodayBriefPayload): string {
  const persistedSelection = payload.topicSelection?.selectedShortlistedItemId;
  if (persistedSelection) {
    return persistedSelection;
  }

  if (typeof window === "undefined") {
    return "";
  }

  try {
    const raw = window.sessionStorage.getItem(BRIEF_SELECTION_CACHE_KEY);
    const cached = raw ? (JSON.parse(raw) as unknown) : null;

    if (!isCachedBriefSelection(cached) || isExpired(cached.cachedAt)) {
      window.sessionStorage.removeItem(BRIEF_SELECTION_CACHE_KEY);
      return "";
    }

    const payloadRunDate = payload.run?.runDate;
    if (payloadRunDate && cached.runDate && payloadRunDate !== cached.runDate) {
      window.sessionStorage.removeItem(BRIEF_SELECTION_CACHE_KEY);
      return "";
    }

    return cached.topicId;
  } catch {
    return "";
  }
}

function writeBriefSelection(topicId: string, payload: TodayBriefPayload | null): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    const cached: CachedBriefSelection = {
      cachedAt: new Date().toISOString(),
      runDate: payload?.run?.runDate ?? todayRunDate(),
      topicId
    };

    window.sessionStorage.setItem(BRIEF_SELECTION_CACHE_KEY, JSON.stringify(cached));
  } catch {
    // sessionStorage can be unavailable in hardened browser modes.
  }
}

function usableBriefPayload(value: unknown): value is TodayBriefPayload {
  return Boolean(
    value &&
      typeof value === "object" &&
      (value as TodayBriefPayload).brief &&
      Array.isArray((value as TodayBriefPayload).shortlistedItems) &&
      (value as TodayBriefPayload).shortlistedItems.length > 0
  );
}

function isCachedBriefState(value: unknown): value is CachedBriefState {
  return Boolean(
    value &&
      typeof value === "object" &&
      typeof (value as CachedBriefState).cachedAt === "string" &&
      usableBriefPayload((value as CachedBriefState).payload)
  );
}

function isCachedBriefSelection(value: unknown): value is CachedBriefSelection {
  return Boolean(
    value &&
      typeof value === "object" &&
      typeof (value as CachedBriefSelection).cachedAt === "string" &&
      typeof (value as CachedBriefSelection).topicId === "string" &&
      (value as CachedBriefSelection).topicId
  );
}

function isExpired(cachedAt: string): boolean {
  const timestamp = Date.parse(cachedAt);
  return !Number.isFinite(timestamp) || Date.now() - timestamp > BRIEF_CACHE_MAX_AGE_MS;
}

function todayRunDate(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));

  return `${byType.year}-${byType.month}-${byType.day}`;
}
