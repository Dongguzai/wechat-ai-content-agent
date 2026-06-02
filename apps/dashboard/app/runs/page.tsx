import Link from "next/link";
import { StatusBadge } from "@/components/status-badge";
import { getRunsData } from "@/lib/dashboard-data";

export default async function RunsPage() {
  const runs = await getRunsData();

  return (
    <div className="space-y-6">
      <section className="rounded-lg border border-line bg-white p-6 shadow-panel">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-stone-500">Runs</p>
        <h2 className="mt-2 text-2xl font-bold text-ink">历史运行记录</h2>
      </section>

      <section className="overflow-hidden rounded-lg border border-line bg-white">
        <div className="grid grid-cols-[150px_1fr_1fr_120px_180px] gap-3 border-b border-line bg-stone-50 px-4 py-3 text-xs font-bold uppercase tracking-[0.12em] text-stone-500">
          <span>日期</span>
          <span>主选题</span>
          <span>文章标题</span>
          <span>状态</span>
          <span>草稿 media_id</span>
        </div>
        {runs.map((run) => (
          <div key={run.id} className="grid grid-cols-[150px_1fr_1fr_120px_180px] gap-3 border-b border-line px-4 py-4 text-sm last:border-b-0">
            <span className="font-semibold text-ink">{run.id}</span>
            <span className="text-stone-700">{run.mainTopic ?? "-"}</span>
            <span className="text-stone-700">{run.articleTitle ?? "-"}</span>
            <span><StatusBadge state={run.success ? "passed" : "failed"} /></span>
            <span className="break-all text-xs text-stone-500">{run.draftMediaId ?? "-"}</span>
            {run.reportPath ? (
              <div className="col-span-5 rounded-md bg-stone-50 p-3 text-xs leading-5 text-stone-600">
                <Link
                  href={`/api/file?path=${encodeURIComponent(run.reportPath)}&raw=1`}
                  className="font-semibold text-ink underline"
                >
                  run-report.md
                </Link>
                <pre className="mt-2 whitespace-pre-wrap">{run.reportPreview}</pre>
              </div>
            ) : null}
          </div>
        ))}
      </section>
    </div>
  );
}
