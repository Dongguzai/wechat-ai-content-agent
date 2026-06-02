import { FeedbackEditor } from "@/components/feedback-editor";
import { getFeedbackData } from "@/lib/dashboard-data";

export default async function FeedbackPage() {
  const records = await getFeedbackData();

  return (
    <div className="space-y-6">
      <section className="rounded-lg border border-line bg-white p-6 shadow-panel">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-stone-500">Feedback</p>
        <h2 className="mt-2 text-2xl font-bold text-ink">人工反馈</h2>
      </section>
      <FeedbackEditor records={records} />
    </div>
  );
}
