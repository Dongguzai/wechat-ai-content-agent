import { StatusBadge } from "@/components/status-badge";
import { getCoverData } from "@/lib/dashboard-data";

export default async function CoverPage() {
  const data = await getCoverData();

  return (
    <div className="space-y-6">
      <section className="rounded-lg border border-line bg-white p-6 shadow-panel">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-stone-500">Cover</p>
            <h2 className="mt-2 text-2xl font-bold text-ink">{data.cover?.title ?? "封面"}</h2>
          </div>
          <StatusBadge state={data.review?.passed ? "passed" : data.review ? "failed" : "missing"} />
        </div>
      </section>

      <section className="grid gap-5 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="rounded-lg border border-line bg-white p-5">
          {data.image ? (
            <img
              src={data.image.dataUrl}
              alt="封面预览"
              className="aspect-[900/383] w-full rounded-md border border-line object-cover"
            />
          ) : (
            <div className="flex aspect-[900/383] items-center justify-center rounded-md border border-dashed border-stone-300 text-sm text-stone-500">
              暂无封面图片
            </div>
          )}
          <p className="mt-3 text-xs text-stone-500">{data.image?.relativePath ?? data.cover?.imagePath ?? "无 imagePath"}</p>
        </div>
        <div className="space-y-4">
          <Info label="mode" value={data.cover?.mode} />
          <Info label="provider" value={data.cover?.provider} />
          <Info label="imagePath" value={data.cover?.imagePath} />
          <Info label="review passed" value={String(Boolean(data.review?.passed))} />
        </div>
      </section>

      <section className="rounded-lg border border-line bg-white p-5">
        <pre className="max-h-[520px] overflow-auto rounded-md bg-stone-950 p-4 text-xs leading-5 text-stone-100">
          {JSON.stringify({ cover: data.cover, review: data.review }, null, 2)}
        </pre>
      </section>
    </div>
  );
}

function Info({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="rounded-lg border border-line bg-white p-4">
      <div className="text-xs font-semibold uppercase tracking-[0.16em] text-stone-400">{label}</div>
      <div className="mt-2 break-words text-sm font-semibold text-ink">{String(value ?? "-")}</div>
    </div>
  );
}
