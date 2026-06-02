import { ActionButton } from "@/components/action-button";
import { BooleanBadge, StatusBadge } from "@/components/status-badge";
import { getCoverData, getWechatData, SAFE_NOTICE } from "@/lib/dashboard-data";
import { readJsonFile } from "@/lib/paths";

type JsonObject = Record<string, any>;

export default async function PreviewPage() {
  const [wechat, cover, articleReview, coverReview, finalPreflight, apiPreflight, draft, apiDraft] =
    await Promise.all([
      getWechatData(),
      getCoverData(),
      readJsonFile<JsonObject>("outputs/article-review.json"),
      readJsonFile<JsonObject>("outputs/cover-review.json"),
      readJsonFile<JsonObject>("outputs/final-preflight.json"),
      readJsonFile<JsonObject>("outputs/wechat-api-preflight.json"),
      readJsonFile<JsonObject>("outputs/wechat-draft-result.json"),
      readJsonFile<JsonObject>("outputs/wechat-api-draft-result.json")
    ]);
  const preflight = finalPreflight ?? apiPreflight;
  const draftStatus = apiDraft ?? draft;

  return (
    <div className="space-y-5">
      <section className="border-b border-line bg-white px-5 py-5">
        <p className="text-xs font-semibold text-stone-500">草稿预览</p>
        <h2 className="mt-2 text-2xl font-bold text-ink">{wechat.layout?.title ?? "公众号排版预览"}</h2>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-stone-600">
          {SAFE_NOTICE}
        </p>
      </section>

      <section className="grid gap-4 md:grid-cols-4">
        <CheckCard label="layout allowed" value={wechat.htmlChecks.allowedNextStage} />
        <CheckCard label="cover review" value={coverReview?.passed === true} />
        <CheckCard label="article review" value={articleReview?.passed === true} />
        <CheckCard label="final preflight" value={preflight?.passed === true} />
      </section>

      <section className="grid gap-5 xl:grid-cols-[260px_minmax(0,1fr)_280px]">
        <aside className="space-y-4">
          <div className="border border-line bg-white p-4">
            <h3 className="text-sm font-bold text-ink">封面预览</h3>
            {cover.image ? (
              <img
                src={cover.image.dataUrl}
                alt="封面预览"
                className="mt-3 aspect-[900/383] w-full border border-line object-cover"
              />
            ) : (
              <div className="mt-3 flex aspect-[900/383] items-center justify-center border border-dashed border-stone-300 text-sm text-stone-500">
                暂无封面
              </div>
            )}
            <p className="mt-2 break-all text-xs text-stone-500">{cover.image?.relativePath ?? cover.cover?.imagePath ?? "无 imagePath"}</p>
          </div>
        </aside>

        <main className="border border-line bg-white p-4">
          {wechat.html ? (
            <iframe
              title="WeChat HTML preview"
              sandbox=""
              srcDoc={wechat.html}
              className="h-[760px] w-full border border-line bg-white"
            />
          ) : (
            <div className="flex h-96 items-center justify-center text-sm text-stone-500">暂无 outputs/wechat.html</div>
          )}
        </main>

        <aside className="space-y-4">
          <div className="border border-line bg-white p-4">
            <h3 className="text-sm font-bold text-ink">下一步</h3>
            <div className="mt-3 space-y-3">
              <ActionButton action="refreshLayout" label="生成 / 刷新排版" />
              <ActionButton action="finalPreflight" label="最终 preflight" />
              <ActionButton action="createWechatDraft" label="写入公众号草稿箱" tone="danger" />
            </div>
          </div>
          <StatusPanel title="wechat-layout.json" value={wechat.layout} />
          <StatusPanel title="cover-review.json" value={coverReview} />
          <StatusPanel title="article-review.json" value={articleReview} />
          <StatusPanel title="final-preflight" value={preflight} />
          <StatusPanel title="微信草稿写入状态" value={draftStatus} />
        </aside>
      </section>
    </div>
  );
}

function CheckCard({ label, value }: { label: string; value: boolean }) {
  return (
    <div className="border border-line bg-white p-4">
      <div className="mb-2 text-sm font-bold text-ink">{label}</div>
      <BooleanBadge value={value} />
    </div>
  );
}

function StatusPanel({ title, value }: { title: string; value: unknown }) {
  const state = stateFromValue(value);
  return (
    <details className="border border-line bg-white p-4">
      <summary className="flex cursor-pointer items-center justify-between gap-3 text-sm font-bold text-ink">
        {title}
        <StatusBadge state={state} />
      </summary>
      <pre className="mt-3 max-h-72 overflow-auto bg-stone-950 p-3 text-xs leading-5 text-stone-100">
        {JSON.stringify(value ?? {}, null, 2)}
      </pre>
    </details>
  );
}

function stateFromValue(value: unknown): "passed" | "failed" | "waiting" | "missing" {
  if (!value || typeof value !== "object") {
    return "missing";
  }
  const object = value as Record<string, any>;
  if (object.passed === true || object.allowedNextStage === true || object.status === "draft_saved" || object.status === "draft_created") {
    return "passed";
  }
  if (object.passed === false || object.allowedNextStage === false) {
    return "failed";
  }
  return "waiting";
}
