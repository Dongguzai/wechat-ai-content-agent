function inlineFormat(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");
}

export function MarkdownPreview({ markdown }: { markdown?: string }) {
  if (!markdown) {
    return (
      <div className="rounded-lg border border-dashed border-stone-300 bg-white/60 p-6 text-sm text-stone-500">
        暂无内容。
      </div>
    );
  }

  const lines = markdown.split(/\r?\n/);
  const html: string[] = [];
  let listOpen = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      if (listOpen) {
        html.push("</ul>");
        listOpen = false;
      }
      continue;
    }

    const heading = /^(#{1,3})\s+(.+)$/.exec(trimmed);
    if (heading) {
      if (listOpen) {
        html.push("</ul>");
        listOpen = false;
      }
      const level = heading[1].length;
      html.push(`<h${level}>${inlineFormat(heading[2])}</h${level}>`);
      continue;
    }

    const listItem = /^[-*]\s+(.+)$/.exec(trimmed);
    if (listItem) {
      if (!listOpen) {
        html.push("<ul>");
        listOpen = true;
      }
      html.push(`<li>${inlineFormat(listItem[1])}</li>`);
      continue;
    }

    if (listOpen) {
      html.push("</ul>");
      listOpen = false;
    }
    html.push(`<p>${inlineFormat(trimmed)}</p>`);
  }

  if (listOpen) {
    html.push("</ul>");
  }

  return (
    <article
      className="prose-preview space-y-4"
      dangerouslySetInnerHTML={{ __html: html.join("\n") }}
    />
  );
}
