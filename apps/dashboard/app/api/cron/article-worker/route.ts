import { handleCronArticleWorker } from "@/lib/article-generation-worker";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(request: Request) {
  return await handleCronArticleWorker(request);
}
