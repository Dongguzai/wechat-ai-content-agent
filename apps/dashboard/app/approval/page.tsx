import { ApprovalForm } from "@/components/approval-form";
import { getApprovalData } from "@/lib/dashboard-data";

export default async function ApprovalPage() {
  const data = await getApprovalData();

  return (
    <div className="space-y-6">
      <section className="rounded-lg border border-line bg-white p-6 shadow-panel">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-stone-500">Human Approval</p>
        <h2 className="mt-2 text-2xl font-bold text-ink">确认今日主选题</h2>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-stone-600">
          推荐主选题：{data.recommendedTopic?.title ?? "暂无"}。也可以改选 10 条入围资讯中的任意一条，保存后会写入 inputs/editorial-approval.json。
        </p>
      </section>
      <section className="rounded-lg border border-line bg-white p-6">
        <ApprovalForm data={data} />
      </section>
    </div>
  );
}
