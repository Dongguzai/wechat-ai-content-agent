"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  AlignCenter,
  AlignLeft,
  Bold,
  CheckCircle2,
  Crop,
  Heading2,
  ImageIcon,
  Italic,
  List,
  Minus,
  Quote,
  Redo2,
  RefreshCw,
  Save,
  Scissors,
  Strikethrough,
  Table,
  Trash2,
  Underline,
  Undo2,
  WandSparkles,
  type LucideIcon
} from "lucide-react";
import type { ArticleData, CoverData } from "@/lib/dashboard-data";

type JsonObject = Record<string, any>;

interface ArticleWorkbenchProps {
  article: ArticleData;
  titleData?: JsonObject;
  cover: CoverData;
}

export function ArticleWorkbench({ article, titleData, cover }: ArticleWorkbenchProps) {
  const router = useRouter();
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const [title, setTitle] = useState(String(article.meta?.title ?? titleData?.selectedTitle ?? ""));
  const [content, setContent] = useState(stripMarkdownTitle(article.markdown ?? ""));
  const [titlesOpen, setTitlesOpen] = useState(false);
  const [coverPrompt, setCoverPrompt] = useState("");
  const [rewriteInstruction, setRewriteInstruction] = useState("");
  const [cropOpen, setCropOpen] = useState(false);
  const [crop, setCrop] = useState({ x: 0, y: 0, width: 900, height: 383, scale: 1 });
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [isPending, startTransition] = useTransition();
  const pending = busy || isPending;

  const candidates = Array.isArray(titleData?.candidates) ? titleData.candidates.slice(0, 5) : [];
  const coverIsMock = String(cover.cover?.mode ?? "").toLowerCase() === "mock" ||
    String(cover.image?.relativePath ?? cover.cover?.imagePath ?? "").toLowerCase().endsWith(".svg");

  async function saveDraft() {
    setMessage("");
    const payload = await postJson("/api/article/save", { title, content });
    setMessage(payload.ok ? "已保存 article.md / article-meta.json。" : payload.error ?? "保存失败。");
  }

  async function refreshPreview() {
    setMessage("");
    const saved = await postJson("/api/article/save", { title, content });
    if (!saved.ok) {
      setMessage(saved.error ?? "保存失败。");
      return;
    }
    const result = await postJson("/api/action", { action: "refreshLayout" });
    if (!result.status || result.status === "failed" || result.status === "rejected") {
      setMessage(result.message ?? result.error ?? "预览刷新失败。");
      return;
    }
    router.push("/preview");
  }

  async function confirmNext() {
    setMessage("");
    const payload = await postJson("/api/article/confirm", { title, content });
    if (payload.next) {
      router.push(payload.next);
      return;
    }
    setMessage(payload.error ?? "文章审核未通过，请查看状态信息后再继续。");
  }

  async function chooseTitle(nextTitle: string) {
    setMessage("");
    const payload = await postJson("/api/article/select-title", { title: nextTitle });
    if (!payload.ok) {
      setMessage(payload.error ?? "标题选择失败。");
      return;
    }
    setTitle(nextTitle);
    setTitlesOpen(false);
    setMessage("标题已更新，并写入 article-meta.json。");
  }

  async function rewriteArticle() {
    setMessage("");
    const payload = await postJson("/api/article/rewrite", {
      content: composeMarkdown(title, content),
      instruction: rewriteInstruction
    });
    if (!payload.ok) {
      setMessage(payload.error ?? "AI 修改失败。");
      return;
    }
    setContent(stripMarkdownTitle(String(payload.rewrittenArticle ?? "")));
    setMessage("AI 已返回修改稿，尚未保存。");
  }

  async function regenerateCover() {
    setMessage("");
    const payload = await postJson("/api/cover/regenerate", { instruction: coverPrompt });
    setMessage(payload.ok ? "封面已重新生成，正在刷新页面。" : payload.error ?? "封面生成失败。");
    if (payload.ok) {
      router.refresh();
    }
  }

  async function saveCrop() {
    setMessage("");
    const payload = await postJson("/api/cover/crop", { crop });
    setMessage(payload.ok ? "裁剪设置已保存，正在刷新封面。" : payload.error ?? "裁剪失败。");
    if (payload.ok) {
      setCropOpen(false);
      router.refresh();
    }
  }

  async function updateCoverVersion(action: "set-current" | "delete", imagePath: string) {
    setMessage("");
    const payload = await postJson("/api/cover/version", { action, imagePath });
    setMessage(payload.ok ? "封面版本已更新。" : payload.error ?? "封面版本更新失败。");
    if (payload.ok) {
      router.refresh();
    }
  }

  function run(action: () => Promise<void>) {
    startTransition(() => {
      setBusy(true);
      void action().finally(() => setBusy(false));
    });
  }

  return (
    <div className="space-y-4">
      <section className="border-b border-line bg-white px-5 py-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <p className="text-xs font-semibold text-stone-500">当前标题</p>
            <h2 className="mt-1 truncate text-lg font-bold text-ink">{title || "未命名文章"}</h2>
          </div>
          <button
            type="button"
            onClick={() => setTitlesOpen((value) => !value)}
            className="inline-flex items-center justify-center gap-2 rounded-md border border-line px-3 py-2 text-sm font-semibold text-stone-700 hover:border-ink hover:text-ink"
          >
            <Heading2 className="size-4" aria-hidden="true" />
            {titlesOpen ? "收起标题候选" : "展开标题候选"}
          </button>
        </div>
        {titlesOpen ? (
          <div className="mt-4 grid gap-3 xl:grid-cols-5">
            {candidates.map((candidate: JsonObject) => (
              <div key={candidate.title} className="border border-line bg-paper p-3">
                <p className="line-clamp-3 min-h-16 text-sm font-bold leading-6 text-ink">{candidate.title}</p>
                <dl className="mt-3 space-y-1 text-xs text-stone-600">
                  <Score label="type" value={candidate.kindLabel ?? candidate.type ?? candidate.kind} />
                  <Score label="final" value={candidate.finalScore} />
                  <Score label="spread" value={candidate.spreadScore} />
                  <Score label="accuracy" value={candidate.accuracyScore} />
                  <Score label="nonClickbait" value={candidate.nonClickbaitScore} />
                </dl>
                <button
                  type="button"
                  onClick={() => run(() => chooseTitle(String(candidate.title)))}
                  disabled={pending}
                  className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-md bg-ink px-3 py-2 text-xs font-semibold text-white disabled:opacity-60"
                >
                  <CheckCircle2 className="size-4" aria-hidden="true" />
                  选择此标题
                </button>
              </div>
            ))}
          </div>
        ) : null}
      </section>

      <div className="grid gap-4 xl:grid-cols-[280px_minmax(0,1fr)_240px]">
        <aside className="space-y-4">
          <section className="border border-line bg-white p-4">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-bold text-ink">封面</h3>
              <button
                type="button"
                onClick={() => setCropOpen(true)}
                className="inline-flex size-8 items-center justify-center rounded-md border border-line text-stone-600 hover:border-ink hover:text-ink"
                title="编辑封面裁剪"
              >
                <Crop className="size-4" aria-hidden="true" />
              </button>
            </div>
            {cover.image ? (
              <img
                src={cover.image.dataUrl}
                alt="当前封面"
                className="aspect-[900/383] w-full border border-line object-cover"
              />
            ) : (
              <div className="flex aspect-[900/383] items-center justify-center border border-dashed border-stone-300 text-xs text-stone-500">
                暂无封面
              </div>
            )}
            <p className="mt-2 break-all text-xs text-stone-500">{cover.image?.relativePath ?? cover.cover?.imagePath ?? "无 imagePath"}</p>
            {coverIsMock ? (
              <p className="mt-2 border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">
                当前封面是 mock/svg，占位图需要人工核验。
              </p>
            ) : null}
          </section>

          <section className="border border-line bg-white p-4">
            <label className="block text-sm font-bold text-ink">
              封面修改 prompt
              <textarea
                value={coverPrompt}
                onChange={(event) => setCoverPrompt(event.target.value)}
                rows={4}
                placeholder="输入封面修改要求，比如：机器人缩小一点，标题区域更干净，颜色更暖。"
                className="mt-2 w-full resize-none border border-line px-3 py-2 text-sm font-normal outline-none focus:border-ink"
              />
            </label>
            <button
              type="button"
              onClick={() => run(regenerateCover)}
              disabled={pending}
              className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-md bg-ink px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
            >
              <RefreshCw className={`size-4 ${pending ? "animate-spin" : ""}`} aria-hidden="true" />
              重新生成
            </button>
          </section>

          <section className="border border-line bg-white p-4">
            <h3 className="text-sm font-bold text-ink">历史版本</h3>
            <div className="mt-3 space-y-3">
              {cover.history.length ? cover.history.map((item) => (
                <div key={item.relativePath} className="border-t border-line pt-3 first:border-t-0 first:pt-0">
                  <p className="text-xs font-semibold text-stone-700">{formatDate(item.updatedAt)} / {item.source}</p>
                  <p className="mt-1 break-all text-xs text-stone-500">{item.relativePath}</p>
                  <div className="mt-2 flex gap-2">
                    <button
                      type="button"
                      onClick={() => run(() => updateCoverVersion("set-current", item.imagePath))}
                      className="inline-flex items-center gap-1 rounded-md border border-line px-2 py-1 text-xs font-semibold text-stone-700 hover:border-ink"
                    >
                      <ImageIcon className="size-3.5" aria-hidden="true" />
                      设为当前
                    </button>
                    <button
                      type="button"
                      onClick={() => run(() => updateCoverVersion("delete", item.imagePath))}
                      className="inline-flex items-center gap-1 rounded-md border border-line px-2 py-1 text-xs font-semibold text-stone-700 hover:border-oxblood hover:text-oxblood"
                    >
                      <Trash2 className="size-3.5" aria-hidden="true" />
                      删除
                    </button>
                  </div>
                </div>
              )) : <p className="text-xs text-stone-500">暂无历史封面。</p>}
            </div>
          </section>
        </aside>

        <main className="min-w-0 border border-line bg-white">
          <div className="border-b border-line px-6 py-5">
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="请输入文章标题"
              className="w-full border-0 bg-transparent text-2xl font-bold leading-tight text-ink outline-none"
            />
            <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-stone-500">
              <span>作者：本地编辑</span>
              <span>公众号：AI 内容观察</span>
              <span>{countReadableUnits(composeMarkdown(title, content))} 字符</span>
            </div>
          </div>

          <Toolbar
            onFormat={(before, after) => formatSelection(editorRef.current, before, after, setContent)}
            onLine={(prefix) => formatLines(editorRef.current, prefix, setContent)}
            onInsert={(text) => insertText(editorRef.current, text, setContent)}
          />

          <textarea
            ref={editorRef}
            value={content}
            onChange={(event) => setContent(event.target.value)}
            className="min-h-[720px] w-full resize-y border-0 px-6 py-5 text-[16px] leading-8 text-stone-800 outline-none"
            placeholder="在这里直接编辑 article.md 正文。"
          />

          <div className="border-t border-line bg-paper px-6 py-5">
            <label className="block text-sm font-bold text-ink">
              AI 修改建议
              <textarea
                value={rewriteInstruction}
                onChange={(event) => setRewriteInstruction(event.target.value)}
                rows={3}
                placeholder="告诉 AI 你想怎么改，比如：开头再犀利一点、减少技术词、结尾更有判断力。"
                className="mt-2 w-full resize-none border border-line bg-white px-3 py-2 text-sm font-normal outline-none focus:border-ink"
              />
            </label>
            <button
              type="button"
              onClick={() => run(rewriteArticle)}
              disabled={pending}
              className="mt-3 inline-flex items-center gap-2 rounded-md border border-ink bg-white px-4 py-2 text-sm font-semibold text-ink disabled:opacity-60"
            >
              <WandSparkles className="size-4" aria-hidden="true" />
              让 AI 修改文章
            </button>
          </div>
        </main>

        <aside className="space-y-4">
          <section className="border border-line bg-white p-4">
            <h3 className="text-sm font-bold text-ink">轻量状态</h3>
            <dl className="mt-3 space-y-3 text-sm">
              <StatusLine label="文章审核" value={article.review?.passed === true ? "通过" : article.review ? "未通过" : "未生成"} />
              <StatusLine label="封面审核" value={cover.review?.passed === true ? "通过" : cover.review ? "未通过" : "未生成"} />
              <StatusLine label="封面模式" value={String(cover.cover?.mode ?? "-")} />
              <StatusLine label="LLM" value={`${article.meta?.llm?.provider ?? "-"} / ${article.meta?.llm?.mode ?? "-"}`} />
            </dl>
            <details className="mt-4">
              <summary className="cursor-pointer text-xs font-semibold text-stone-600">查看详情</summary>
              <pre className="mt-3 max-h-80 overflow-auto bg-stone-950 p-3 text-xs leading-5 text-stone-100">
                {JSON.stringify({ articleMeta: article.meta, articleReview: article.review, cover: cover.cover }, null, 2)}
              </pre>
            </details>
          </section>
        </aside>
      </div>

      <section className="sticky bottom-0 z-20 border border-line bg-white/95 px-5 py-4 backdrop-blur">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <p className="min-h-5 text-sm text-stone-600">{message}</p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => run(saveDraft)}
              disabled={pending}
              className="inline-flex items-center gap-2 rounded-md border border-line px-4 py-2 text-sm font-semibold text-stone-700 disabled:opacity-60"
            >
              <Save className="size-4" aria-hidden="true" />
              保存草稿
            </button>
            <button
              type="button"
              onClick={() => run(refreshPreview)}
              disabled={pending}
              className="inline-flex items-center gap-2 rounded-md border border-ink px-4 py-2 text-sm font-semibold text-ink disabled:opacity-60"
            >
              <RefreshCw className="size-4" aria-hidden="true" />
              预览排版
            </button>
            <button
              type="button"
              onClick={() => run(confirmNext)}
              disabled={pending}
              className="inline-flex items-center gap-2 rounded-md bg-ink px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
            >
              <CheckCircle2 className="size-4" aria-hidden="true" />
              确认下一步
            </button>
          </div>
        </div>
      </section>

      {cropOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
          <div className="w-full max-w-3xl border border-line bg-white p-5 shadow-panel">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-ink">封面裁剪</h3>
              <button type="button" onClick={() => setCropOpen(false)} className="text-sm font-semibold text-stone-500">
                关闭
              </button>
            </div>
            <div className="relative mt-4 aspect-[900/383] overflow-hidden border border-line bg-paper">
              {cover.image ? (
                <img
                  src={cover.image.dataUrl}
                  alt="封面裁剪预览"
                  className="size-full object-cover"
                  style={{ transform: `scale(${crop.scale})` }}
                />
              ) : null}
              <div className="pointer-events-none absolute inset-x-[8%] inset-y-[14%] border border-white/90 shadow-[0_0_0_999px_rgba(0,0,0,0.12)]" />
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-5">
              <CropField label="x" value={crop.x} onChange={(value) => setCrop({ ...crop, x: value })} />
              <CropField label="y" value={crop.y} onChange={(value) => setCrop({ ...crop, y: value })} />
              <CropField label="width" value={crop.width} onChange={(value) => setCrop({ ...crop, width: value })} />
              <CropField label="height" value={crop.height} onChange={(value) => setCrop({ ...crop, height: value })} />
              <CropField label="scale" step={0.05} value={crop.scale} onChange={(value) => setCrop({ ...crop, scale: value })} />
            </div>
            <button
              type="button"
              onClick={() => run(saveCrop)}
              disabled={pending}
              className="mt-5 inline-flex items-center gap-2 rounded-md bg-ink px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
            >
              <Scissors className="size-4" aria-hidden="true" />
              保存裁剪
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Toolbar({
  onFormat,
  onLine,
  onInsert
}: {
  onFormat: (before: string, after?: string) => void;
  onLine: (prefix: string) => void;
  onInsert: (text: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1 border-b border-line bg-paper px-4 py-2">
      <Tool icon={Undo2} label="撤销" onClick={() => document.execCommand("undo")} />
      <Tool icon={Redo2} label="重做" onClick={() => document.execCommand("redo")} />
      <Tool icon={Bold} label="加粗" onClick={() => onFormat("**")} />
      <Tool icon={Italic} label="斜体" onClick={() => onFormat("*")} />
      <Tool icon={Underline} label="下划线" onClick={() => onFormat("<u>", "</u>")} />
      <Tool icon={Strikethrough} label="删除线" onClick={() => onFormat("~~")} />
      <Tool icon={Heading2} label="标题" onClick={() => onLine("## ")} />
      <Tool icon={Quote} label="引用" onClick={() => onLine("> ")} />
      <Tool icon={Minus} label="分割线" onClick={() => onInsert("\n\n---\n\n")} />
      <Tool icon={List} label="列表" onClick={() => onLine("- ")} />
      <Tool icon={AlignLeft} label="左对齐" onClick={() => onInsert("\n\n<!-- align:left -->\n\n")} />
      <Tool icon={AlignCenter} label="居中" onClick={() => onInsert("\n\n<!-- align:center -->\n\n")} />
      <Tool icon={Table} label="表格" onClick={() => onInsert("\n\n| 项目 | 内容 |\n| --- | --- |\n|  |  |\n\n")} />
    </div>
  );
}

function Tool({
  icon: Icon,
  label,
  onClick
}: {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      className="inline-flex size-8 items-center justify-center rounded-md text-stone-600 hover:bg-white hover:text-ink"
    >
      <Icon className="size-4" aria-hidden="true" />
    </button>
  );
}

function Score({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="flex justify-between gap-2">
      <dt>{label}</dt>
      <dd className="font-semibold text-ink">{String(value ?? "-")}</dd>
    </div>
  );
}

function StatusLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3 border-t border-line pt-3 first:border-t-0 first:pt-0">
      <dt className="text-stone-500">{label}</dt>
      <dd className="font-semibold text-ink">{value}</dd>
    </div>
  );
}

function CropField({
  label,
  value,
  onChange,
  step = 1
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  step?: number;
}) {
  return (
    <label className="block text-xs font-semibold text-stone-600">
      {label}
      <input
        type="number"
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="mt-1 w-full border border-line px-2 py-1.5 text-sm outline-none focus:border-ink"
      />
    </label>
  );
}

async function postJson(url: string, body?: unknown): Promise<JsonObject> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  return await response.json();
}

function stripMarkdownTitle(markdown: string): string {
  const lines = markdown.split(/\r?\n/);
  const firstContent = lines.findIndex((line) => line.trim().length > 0);
  if (firstContent === -1) {
    return "";
  }
  if (/^#{1,6}\s+\S/.test(lines[firstContent].trim())) {
    return lines.slice(firstContent + 1).join("\n").trimStart();
  }
  return markdown;
}

function composeMarkdown(title: string, content: string): string {
  return `# ${title}\n\n${content.trim()}\n`;
}

function countReadableUnits(markdown: string): number {
  return [...markdown.replace(/\s+/g, "")].length;
}

function formatSelection(
  textarea: HTMLTextAreaElement | null,
  before: string,
  after: string | undefined,
  setContent: (value: string) => void
) {
  if (!textarea) {
    return;
  }
  const closing = after ?? before;
  const next =
    textarea.value.slice(0, textarea.selectionStart) +
    before +
    textarea.value.slice(textarea.selectionStart, textarea.selectionEnd) +
    closing +
    textarea.value.slice(textarea.selectionEnd);
  setContent(next);
  textarea.focus();
}

function formatLines(
  textarea: HTMLTextAreaElement | null,
  prefix: string,
  setContent: (value: string) => void
) {
  if (!textarea) {
    return;
  }
  const selected = textarea.value.slice(textarea.selectionStart, textarea.selectionEnd);
  const replacement = selected
    ? selected.split(/\r?\n/).map((line) => `${prefix}${line}`).join("\n")
    : prefix;
  const next = textarea.value.slice(0, textarea.selectionStart) + replacement + textarea.value.slice(textarea.selectionEnd);
  setContent(next);
  textarea.focus();
}

function insertText(
  textarea: HTMLTextAreaElement | null,
  text: string,
  setContent: (value: string) => void
) {
  if (!textarea) {
    return;
  }
  const next = textarea.value.slice(0, textarea.selectionStart) + text + textarea.value.slice(textarea.selectionEnd);
  setContent(next);
  textarea.focus();
}

function formatDate(value: string | undefined): string {
  if (!value) {
    return "-";
  }
  return new Date(value).toLocaleString("zh-CN", { hour12: false });
}
