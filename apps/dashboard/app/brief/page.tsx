import { BriefTopicList } from "@/components/brief-topic-list";
import { StatusBadge } from "@/components/status-badge";
import { getBriefData } from "@/lib/dashboard-data";

export default async function BriefPage() {
  const data = await getBriefData();

  return (
    <div className="space-y-5">
      <section className="border-b border-line bg-white px-5 py-5">
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-xs font-semibold text-stone-500">每日第一入口</p>
            <h2 className="mt-2 text-2xl font-bold text-ink">今日 10 条入围资讯阅读清单</h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-stone-600">
              AI 推荐主选题：{data.recommended?.title ?? "暂无"}。你可以从入围资讯中任选一条进入文章编辑。
            </p>
          </div>
          <StatusBadge state={data.shortlisted.length === 10 ? "passed" : data.source === "missing" ? "missing" : "waiting"} />
        </div>
      </section>

      <BriefTopicList
        items={data.shortlisted.slice(0, 10)}
        initialApproval={data.approval}
      />
    </div>
  );
}
