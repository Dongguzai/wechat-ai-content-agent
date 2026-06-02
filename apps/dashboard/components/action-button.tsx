"use client";

import { useState } from "react";
import {
  Archive,
  FileCheck2,
  MessageSquarePlus,
  PenLine,
  Image,
  RefreshCw,
  ShieldCheck,
  WandSparkles
} from "lucide-react";
import type { DashboardAction } from "@/lib/actions";

const icons = {
  generateBrief: RefreshCw,
  continueArticle: PenLine,
  draftDryRun: Archive,
  refreshLayout: RefreshCw,
  finalPreflight: FileCheck2,
  createWechatDraft: ShieldCheck,
  createFeedback: MessageSquarePlus,
  rewriteArticle: WandSparkles,
  regenerateCover: Image
};

export function ActionButton({
  action,
  label,
  tone = "default"
}: {
  action: DashboardAction;
  label: string;
  tone?: "default" | "danger";
}) {
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string>("");
  const Icon = icons[action];

  async function runAction() {
    setPending(true);
    setMessage("");
    try {
      const response = await fetch("/api/action", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action })
      });
      const payload = await response.json();
      setMessage(payload.message ?? payload.error ?? "Action finished.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Action failed.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={runAction}
        disabled={pending}
        className={`inline-flex w-full items-center justify-center gap-2 rounded-lg border px-4 py-2.5 text-sm font-semibold transition disabled:cursor-wait disabled:opacity-60 ${
          tone === "danger"
            ? "border-oxblood/30 bg-oxblood text-white hover:bg-oxblood/90"
            : "border-ink bg-ink text-white hover:bg-stone-800"
        }`}
        title={label}
      >
        <Icon className={`size-4 ${pending ? "animate-spin" : ""}`} aria-hidden="true" />
        {pending ? "执行中" : label}
      </button>
      {message ? <p className="text-xs text-stone-500">{message}</p> : null}
    </div>
  );
}
