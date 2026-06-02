"use client";

import { useState } from "react";
import { ListChecks, Save, WandSparkles } from "lucide-react";
import type { ApprovalData } from "@/lib/dashboard-data";

export function ApprovalForm({ data }: { data: ApprovalData }) {
  const [approval, setApproval] = useState(data.approval);
  const [message, setMessage] = useState("");

  const recommendedTitle = data.recommendedTopic?.title ?? "";
  const recommendedId = data.recommendedTopic?.id ?? "";

  async function save() {
    setMessage("");
    const response = await fetch("/api/approval", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(approval)
    });
    const payload = await response.json();
    setMessage(payload.ok ? "已保存 inputs/editorial-approval.json" : payload.error);
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          onClick={() =>
            setApproval((current) => ({
              ...current,
              approvedTopicId: recommendedId,
              approvedTitle: recommendedTitle,
              approvedByUser: false
            }))
          }
          className="inline-flex items-center gap-2 rounded-lg border border-line bg-white px-4 py-2 text-sm font-semibold text-ink hover:bg-stone-50"
        >
          <WandSparkles className="size-4" aria-hidden="true" />
          填入推荐主选题
        </button>
      </div>

      {data.shortlistedItems.length ? (
        <div className="rounded-lg border border-line bg-white p-4">
          <div className="flex items-center gap-2 text-sm font-bold text-ink">
            <ListChecks className="size-4" aria-hidden="true" />
            入围资讯快速选择
          </div>
          <div className="mt-3 grid gap-2 md:grid-cols-2">
            {data.shortlistedItems.slice(0, 10).map((item, index) => (
              <button
                key={`${item.id ?? item.title}-${index}`}
                type="button"
                onClick={() =>
                  setApproval((current) => ({
                    ...current,
                    approvedByUser: false,
                    approvedTopicId: String(item.id ?? ""),
                    approvedTitle: String(item.title ?? "")
                  }))
                }
                className="rounded-lg border border-line px-3 py-2 text-left text-sm font-semibold text-ink hover:bg-stone-50"
              >
                {index + 1}. {item.title ?? "未命名资讯"}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <label className="flex items-center gap-3 rounded-lg border border-line bg-white p-4 text-sm font-semibold">
        <input
          type="checkbox"
          checked={approval.approvedByUser}
          onChange={(event) =>
            setApproval((current) => ({
              ...current,
              approvedByUser: event.target.checked
            }))
          }
          className="size-4 accent-ink"
        />
        已人工确认选题
      </label>

      <label className="block text-sm font-semibold text-stone-700">
        approvedTopicId
        <input
          value={approval.approvedTopicId}
          onChange={(event) =>
            setApproval((current) => ({
              ...current,
              approvedTopicId: event.target.value
            }))
          }
          className="mt-2 w-full rounded-lg border border-line bg-white px-3 py-2 text-sm outline-none focus:border-ink"
        />
      </label>

      <label className="block text-sm font-semibold text-stone-700">
        approvedTitle
        <input
          value={approval.approvedTitle}
          onChange={(event) =>
            setApproval((current) => ({
              ...current,
              approvedTitle: event.target.value
            }))
          }
          className="mt-2 w-full rounded-lg border border-line bg-white px-3 py-2 text-sm outline-none focus:border-ink"
        />
      </label>

      <label className="block text-sm font-semibold text-stone-700">
        notes
        <textarea
          value={approval.notes}
          onChange={(event) =>
            setApproval((current) => ({
              ...current,
              notes: event.target.value
            }))
          }
          rows={5}
          className="mt-2 w-full rounded-lg border border-line bg-white px-3 py-2 text-sm outline-none focus:border-ink"
        />
      </label>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={save}
          className="inline-flex items-center gap-2 rounded-lg bg-ink px-4 py-2.5 text-sm font-semibold text-white hover:bg-stone-800"
        >
          <Save className="size-4" aria-hidden="true" />
          保存确认
        </button>
        {approval.approvedByUser ? (
          <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
            可以继续写文章
          </span>
        ) : null}
      </div>
      {message ? <p className="text-sm text-stone-500">{message}</p> : null}
    </div>
  );
}
