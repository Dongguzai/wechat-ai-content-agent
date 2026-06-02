import { StatusBadge } from "@/components/status-badge";
import { getTitlesData } from "@/lib/dashboard-data";

export default async function TitlesPage() {
  const data = await getTitlesData();
  const candidates = data?.candidates ?? [];

  return (
    <div className="space-y-6">
      <section className="rounded-lg border border-line bg-white p-6 shadow-panel">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-stone-500">Titles</p>
            <h2 className="mt-2 text-2xl font-bold text-ink">{data?.selectedTitle ?? "标题候选"}</h2>
          </div>
          <StatusBadge state={data ? "passed" : "missing"} />
        </div>
      </section>

      <section className="grid gap-4">
        {candidates.map((candidate: any) => (
          <div key={candidate.title} className="rounded-lg border border-line bg-white p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold text-stone-500">{candidate.kindLabel ?? candidate.kind}</p>
                <h3 className="mt-1 text-lg font-bold text-ink">{candidate.title}</h3>
              </div>
              <div className="rounded-full bg-ink px-3 py-1 text-sm font-bold text-white">{candidate.finalScore}</div>
            </div>
            <p className="mt-3 text-sm leading-6 text-stone-600">{candidate.rationale}</p>
            <div className="mt-4 grid gap-2 text-xs text-stone-500 md:grid-cols-5">
              <span>spread {candidate.spreadScore}</span>
              <span>accuracy {candidate.accuracyScore}</span>
              <span>nonClickbait {candidate.nonClickbaitScore}</span>
              <span>wechat {candidate.wechatFitScore}</span>
              <span>thesis {candidate.thesisMatchScore}</span>
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}
