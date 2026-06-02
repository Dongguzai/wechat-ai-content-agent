"use client";

import { useMemo, useState } from "react";
import { FilePlus2, Plus, Save } from "lucide-react";
import type { FeedbackRecord } from "@/lib/dashboard-data";

const emptyFeedback = {
  date: new Date().toISOString().slice(0, 10),
  title: "",
  topic: "",
  draftMediaId: "",
  published: false,
  views: 0,
  likes: 0,
  shares: 0,
  myRating: 0,
  topicQuality: 0,
  titleQuality: 0,
  coverQuality: 0,
  articleProblems: [],
  notes: ""
};

export function FeedbackEditor({ records }: { records: FeedbackRecord[] }) {
  const initial = useMemo(
    () => records.find((record) => record.fileName !== "template.json") ?? records[0],
    [records]
  );
  const [fileName, setFileName] = useState(initial?.fileName ?? `${emptyFeedback.date}.json`);
  const [feedback, setFeedback] = useState({ ...emptyFeedback, ...(initial?.data ?? {}) });
  const [message, setMessage] = useState("");

  function selectFile(nextFileName: string) {
    const record = records.find((item) => item.fileName === nextFileName);
    setFileName(nextFileName);
    setFeedback({ ...emptyFeedback, ...(record?.data ?? {}) });
  }

  async function save(createTemplate = false) {
    setMessage("");
    const response = await fetch("/api/feedback", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ fileName, feedback, createTemplate })
    });
    const payload = await response.json();
    setMessage(payload.ok ? `已保存 ${payload.path}` : payload.error);
  }

  async function createCurrent() {
    setMessage("");
    const response = await fetch("/api/feedback/create-current", {
      method: "POST"
    });
    const payload = await response.json();
    if (!payload.ok) {
      setMessage(payload.error ?? "生成失败。");
      return;
    }
    setFileName(String(payload.path ?? "").replace(/^feedback\//, ""));
    setFeedback({ ...emptyFeedback, ...(payload.feedback ?? {}) });
    setMessage(`已生成 ${payload.path}`);
  }

  const dailyRecords = records.filter((record) => record.fileName !== "template.json");
  const templateRecords = records.filter((record) => record.fileName === "template.json");

  return (
    <div className="grid gap-5 lg:grid-cols-[260px_1fr]">
      <div className="rounded-lg border border-line bg-white p-4">
        <button
          type="button"
          onClick={createCurrent}
          className="mb-3 inline-flex w-full items-center justify-center gap-2 rounded-md bg-ink px-3 py-2 text-sm font-semibold text-white"
        >
          <FilePlus2 className="size-4" aria-hidden="true" />
          基于当前文章生成反馈
        </button>
        <button
          type="button"
          onClick={() => save(true)}
          className="mb-4 inline-flex w-full items-center justify-center gap-2 rounded-md border border-line px-3 py-2 text-sm font-semibold text-stone-700"
        >
          <Plus className="size-4" aria-hidden="true" />
          新建今日模板
        </button>
        <div className="space-y-1">
          {dailyRecords.map((record) => (
            <button
              key={record.fileName}
              type="button"
              onClick={() => selectFile(record.fileName)}
              className={`block w-full rounded-md px-3 py-2 text-left text-sm ${
                record.fileName === fileName ? "bg-stone-900 text-white" : "text-stone-600 hover:bg-stone-100"
              }`}
            >
              {record.fileName}
            </button>
          ))}
          {templateRecords.length ? (
            <div className="pt-3">
              <p className="px-3 text-xs font-semibold text-stone-400">模板</p>
              {templateRecords.map((record) => (
                <button
                  key={record.fileName}
                  type="button"
                  onClick={() => selectFile(record.fileName)}
                  className={`mt-1 block w-full rounded-md px-3 py-2 text-left text-sm ${
                    record.fileName === fileName ? "bg-stone-900 text-white" : "text-stone-500 hover:bg-stone-100"
                  }`}
                >
                  {record.fileName}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </div>

      <div className="rounded-lg border border-line bg-white p-5">
        <div className="grid gap-4 md:grid-cols-2">
          <TextField label="fileName" value={fileName} onChange={setFileName} />
          <TextField label="date" value={feedback.date} onChange={(value) => setFeedback({ ...feedback, date: value })} />
          <TextField label="title" value={feedback.title} onChange={(value) => setFeedback({ ...feedback, title: value })} wide />
          <TextField label="topic" value={feedback.topic} onChange={(value) => setFeedback({ ...feedback, topic: value })} wide />
          <TextField label="draftMediaId" value={feedback.draftMediaId} onChange={(value) => setFeedback({ ...feedback, draftMediaId: value })} wide />
          <NumberField label="views" value={feedback.views} onChange={(value) => setFeedback({ ...feedback, views: value })} />
          <NumberField label="likes" value={feedback.likes} onChange={(value) => setFeedback({ ...feedback, likes: value })} />
          <NumberField label="shares" value={feedback.shares} onChange={(value) => setFeedback({ ...feedback, shares: value })} />
          <NumberField label="myRating" value={feedback.myRating} onChange={(value) => setFeedback({ ...feedback, myRating: value })} />
          <NumberField label="topicQuality" value={feedback.topicQuality} onChange={(value) => setFeedback({ ...feedback, topicQuality: value })} />
          <NumberField label="titleQuality" value={feedback.titleQuality} onChange={(value) => setFeedback({ ...feedback, titleQuality: value })} />
          <NumberField label="coverQuality" value={feedback.coverQuality ?? 0} onChange={(value) => setFeedback({ ...feedback, coverQuality: value })} />
        </div>
        <label className="mt-4 flex items-center gap-3 text-sm font-semibold">
          <input
            type="checkbox"
            checked={Boolean(feedback.published)}
            onChange={(event) => setFeedback({ ...feedback, published: event.target.checked })}
            className="size-4 accent-ink"
          />
          published
        </label>
        <label className="mt-4 block text-sm font-semibold text-stone-700">
          notes
          <textarea
            value={feedback.notes}
            onChange={(event) => setFeedback({ ...feedback, notes: event.target.value })}
            rows={6}
            className="mt-2 w-full rounded-lg border border-line px-3 py-2 outline-none focus:border-ink"
          />
        </label>
        <button
          type="button"
          onClick={() => save(false)}
          className="mt-5 inline-flex items-center gap-2 rounded-lg bg-ink px-4 py-2.5 text-sm font-semibold text-white"
        >
          <Save className="size-4" aria-hidden="true" />
          保存反馈
        </button>
        {message ? <p className="mt-3 text-sm text-stone-500">{message}</p> : null}
      </div>
    </div>
  );
}

function TextField({
  label,
  value,
  onChange,
  wide = false
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  wide?: boolean;
}) {
  return (
    <label className={`block text-sm font-semibold text-stone-700 ${wide ? "md:col-span-2" : ""}`}>
      {label}
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-2 w-full rounded-lg border border-line px-3 py-2 outline-none focus:border-ink"
      />
    </label>
  );
}

function NumberField({
  label,
  value,
  onChange
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="block text-sm font-semibold text-stone-700">
      {label}
      <input
        type="number"
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="mt-2 w-full rounded-lg border border-line px-3 py-2 outline-none focus:border-ink"
      />
    </label>
  );
}
