import { handleCronGenerateBrief } from "@/lib/cron-generate-brief";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: Request) {
  return await handleCronGenerateBrief(request);
}

export async function GET(request: Request) {
  return await handleCronGenerateBrief(request);
}
