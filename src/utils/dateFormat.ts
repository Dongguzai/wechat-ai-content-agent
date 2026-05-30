function pad2(value: number): string {
  return value.toString().padStart(2, "0");
}

export function formatLocalDateKey(date: Date): string {
  return [
    date.getFullYear(),
    pad2(date.getMonth() + 1),
    pad2(date.getDate())
  ].join("-");
}

export function formatRunArchiveTimestamp(date: Date): string {
  return `${formatLocalDateKey(date)}-${pad2(date.getHours())}${pad2(
    date.getMinutes()
  )}${pad2(date.getSeconds())}`;
}
