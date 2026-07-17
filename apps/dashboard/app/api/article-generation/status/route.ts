import { handleArticleGenerationStatus } from "@/lib/article-generation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: Request) {
  return await handleArticleGenerationStatus(request);
}
