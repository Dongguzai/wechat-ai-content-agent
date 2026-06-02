import Link from "next/link";
import type { ReactNode } from "react";
import {
  FileText,
  History,
  Home,
  Image,
  LayoutTemplate,
  MessageSquareText,
  Newspaper,
  Settings,
  ShieldCheck,
  TextCursorInput
} from "lucide-react";
import { getDashboardStatus, SAFE_NOTICE } from "@/lib/dashboard-data";
import { StatusBadge } from "./status-badge";

const navItems = [
  { href: "/brief", label: "简报", icon: Newspaper },
  { href: "/article", label: "文章", icon: FileText },
  { href: "/preview", label: "预览", icon: LayoutTemplate },
  { href: "/feedback", label: "反馈", icon: MessageSquareText }
];

const debugItems = [
  { href: "/", label: "总览", icon: Home },
  { href: "/approval", label: "确认", icon: ShieldCheck },
  { href: "/titles", label: "标题", icon: TextCursorInput },
  { href: "/cover", label: "封面", icon: Image },
  { href: "/wechat", label: "微信", icon: LayoutTemplate },
  { href: "/runs", label: "Runs", icon: History },
  { href: "/settings", label: "设置", icon: Settings }
];

export async function DashboardShell({ children }: { children: ReactNode }) {
  const status = await getDashboardStatus();
  const topState = status.steps.every((step) => step.state === "passed" || step.key === "human-publish")
    ? "passed"
    : status.steps.some((step) => step.state === "failed")
      ? "failed"
      : "waiting";

  return (
    <div className="min-h-screen">
      <aside className="fixed inset-y-0 left-0 hidden w-24 border-r border-line bg-white/88 px-3 py-5 backdrop-blur xl:block">
        <div className="mb-8 flex flex-col items-center gap-2">
          <div className="flex size-10 items-center justify-center rounded-md bg-ink text-white">
            <ShieldCheck className="size-5" aria-hidden="true" />
          </div>
          <div className="text-center text-xs font-bold leading-4">公众号<br />工作台</div>
        </div>
        <nav className="space-y-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className="flex flex-col items-center gap-1 rounded-md px-2 py-3 text-xs font-semibold text-stone-600 transition hover:bg-stone-100 hover:text-ink"
              >
                <Icon className="size-4" aria-hidden="true" />
                {item.label}
              </Link>
            );
          })}
        </nav>
      </aside>

      <main className="xl:pl-24">
        <header className="sticky top-0 z-20 border-b border-line bg-paper/90 backdrop-blur">
          <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-5 py-4">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-500">
                今日状态
              </div>
              <div className="mt-1 flex items-center gap-3">
                <h1 className="text-lg font-bold text-ink">{status.finalTitle ?? status.selectedTopicTitle ?? "等待今日产物"}</h1>
                <StatusBadge state={topState} />
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="hidden max-w-md border border-line bg-white px-4 py-2 text-xs font-medium text-stone-600 md:block">
                {SAFE_NOTICE}
              </div>
              <details className="relative">
                <summary className="cursor-pointer rounded-md border border-line bg-white px-3 py-2 text-sm font-semibold text-stone-700">
                  更多 / 调试
                </summary>
                <div className="absolute right-0 mt-2 w-44 border border-line bg-white p-2 shadow-panel">
                  {debugItems.map((item) => {
                    const Icon = item.icon;
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        className="flex items-center gap-2 rounded-md px-3 py-2 text-sm font-semibold text-stone-600 hover:bg-stone-100 hover:text-ink"
                      >
                        <Icon className="size-4" aria-hidden="true" />
                        {item.label}
                      </Link>
                    );
                  })}
                </div>
              </details>
            </div>
          </div>
        </header>
        <div className="mx-auto max-w-7xl px-5 py-6">{children}</div>
      </main>
    </div>
  );
}
