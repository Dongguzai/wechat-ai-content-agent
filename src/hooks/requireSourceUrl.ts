type SourceUrlItem = {
  title: string;
  url?: string;
};

export function requireSourceUrl<T extends SourceUrlItem>(items: T | T[]): void {
  const list = Array.isArray(items) ? items : [items];
  const missingUrl = list.find(
    (item) => typeof item.url !== "string" || item.url.trim().length === 0
  );

  if (missingUrl) {
    throw new Error(`News item is missing source url: ${missingUrl.title}`);
  }
}
