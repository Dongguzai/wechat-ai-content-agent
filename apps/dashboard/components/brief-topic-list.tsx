"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, ExternalLink } from "lucide-react";
import type { BriefData } from "@/lib/dashboard-data";

type BriefApproval = BriefData["approval"];

interface BriefTopicListProps {
  items: Record<string, any>[];
  initialApproval: BriefApproval;
}

export function BriefTopicList({ items, initialApproval }: BriefTopicListProps) {
  const router = useRouter();
  const [approval, setApproval] = useState(initialApproval);
  const [selectedId, setSelectedId] = useState(initialApproval.approvedTopicId);
  const [message, setMessage] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  async function selectTopic(item: Record<string, any>) {
    const topicId = String(item.id ?? "");
    const nextApproval = {
      approvedByUser: true,
      approvedTopicId: topicId,
      approvedTitle: String(item.title ?? "")
    };

    setIsSaving(true);
    setMessage("");
    try {
      const response = await fetch("/api/brief/select-topic", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ topicId })
      });
      const payload = await response.json();

      if (payload.ok) {
        setApproval({ ...nextApproval, notes: "" });
        setSelectedId(nextApproval.approvedTopicId);
        setMessage("已选择主题，正在进入文章编辑。");
        router.push(payload.redirectTo ?? "/article");
      } else {
        setMessage(payload.error ?? "保存失败。");
      }
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      {items.slice(0, 10).map((item, index) => {
        const id = String(item.id ?? `${item.title}-${index}`);
        const title = String(item.title ?? "未命名资讯");
        const url = String(item.url ?? "");
        const tags = Array.isArray(item.tags) ? item.tags.join(", ") : String(item.tags ?? "");
        const category = String(item.category ?? "");
        const summary = String(item.summary ?? "");
        const topicAngle = String(item.topicAngle ?? item.editorial?.topicAngle ?? item.selection?.writingAngle ?? "");
        const shortlistReason = String(item.shortlistReason ?? item.editorial?.shortlistReason ?? item.selection?.selectedReason ?? "");
        const riskNotes = Array.isArray(item.riskNotes)
          ? item.riskNotes
          : Array.isArray(item.selection?.riskNotes)
            ? item.selection.riskNotes
            : [];
        const isSelected = selectedId === id;
        const sourceType = String(item.sourceType ?? "");
        const canSelect = Boolean(url && item.id && item.title);

        return (
          <article key={id} className="border border-line bg-white p-5">
            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div className="min-w-0">
                <p className="text-xs font-semibold text-stone-500">#{String(item.rank ?? index + 1)}</p>
                <h3 className="mt-1 text-base font-bold leading-6 text-ink">{title}</h3>
                <p className="mt-2 break-all text-sm text-stone-600">{url || "缺少 original url"}</p>
                {sourceType === "global_search" ? (
                  <p className="mt-2 inline-flex border border-amber-200 bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-800">
                    global_search 来源，需要回到原文核验。
                  </p>
                ) : null}
              </div>
              <div className="flex shrink-0 flex-wrap gap-2 md:flex-col">
                {url ? (
                  <a
                    href={url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center justify-center gap-2 rounded-md border border-line px-3 py-2 text-sm font-semibold text-stone-700 hover:border-ink hover:text-ink"
                  >
                    <ExternalLink className="size-4" aria-hidden="true" />
                    阅读原文
                  </a>
                ) : null}
                <button
                  type="button"
                  onClick={() => selectTopic(item)}
                  disabled={isSaving || !canSelect}
                  className="inline-flex items-center justify-center gap-2 rounded-md bg-ink px-3 py-2 text-sm font-semibold text-white hover:bg-stone-800 disabled:cursor-not-allowed disabled:bg-stone-300"
                >
                  <Check className="size-4" aria-hidden="true" />
                  选择此主题
                </button>
              </div>
            </div>
            <dl className="mt-4 grid gap-3 text-sm md:grid-cols-2">
              <Info label="sourceName / sourceType" value={sourceLabel(item)} />
              <Info label="provider / query" value={providerLabel(item)} />
              <Info label="category / tags" value={[category, tags].filter(Boolean).join(" / ") || "无"} />
              <Info label="shortlistScore" value={String(item.shortlistScore ?? item.scores?.final ?? "-")} />
              <Info label="summary" value={summary} wide />
              <Info label="topicAngle" value={topicAngle} wide />
              <Info label="shortlistReason" value={shortlistReason} wide />
              <Info label="riskNotes" value={riskNotes.length ? riskNotes.join("；") : "无"} wide />
            </dl>
            {isSelected ? (
              <p className="mt-3 text-xs font-semibold text-emerald-700">
                已写入 inputs/editorial-approval.json。
              </p>
            ) : null}
          </article>
        );
      })}
      {message ? <p className="text-sm text-stone-500">{message}</p> : null}
    </div>
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

function sourceLabel(item: Record<string, any>): string {
  const sourceName = String(item.sourceName ?? "unknown");
  const sourceType = String(item.sourceType ?? "unknown");

  return `${sourceName} / ${sourceType}`;
}

function providerLabel(item: Record<string, any>): string {
  return `${String(item.provider ?? "无")} / ${String(item.query ?? "无")}`;
}
