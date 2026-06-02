import type { DashboardStep } from "@/lib/dashboard-data";

const styles: Record<DashboardStep["state"], string> = {
  passed: "border-emerald-200 bg-emerald-50 text-emerald-700",
  failed: "border-red-200 bg-red-50 text-red-700",
  waiting: "border-amber-200 bg-amber-50 text-amber-800",
  missing: "border-stone-200 bg-stone-100 text-stone-500"
};

const labels: Record<DashboardStep["state"], string> = {
  passed: "passed",
  failed: "failed",
  waiting: "waiting",
  missing: "missing"
};

export function StatusBadge({ state }: { state: DashboardStep["state"] }) {
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold ${styles[state]}`}>
      {labels[state]}
    </span>
  );
}

export function BooleanBadge({ value }: { value: boolean }) {
  return <StatusBadge state={value ? "passed" : "failed"} />;
}
