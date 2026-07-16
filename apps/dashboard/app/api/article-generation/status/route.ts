import { handleArticleGenerationStatus } from "@/lib/article-generation";

export const runtime = "nodejs";

export async function GET(request: Request) {
  return await handleArticleGenerationStatus(request);
}
