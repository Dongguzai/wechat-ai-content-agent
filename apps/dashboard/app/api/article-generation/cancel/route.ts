import { handleArticleGenerationCancel } from "@/lib/article-generation";

export const runtime = "nodejs";

export async function POST(request: Request) {
  return await handleArticleGenerationCancel(request);
}
