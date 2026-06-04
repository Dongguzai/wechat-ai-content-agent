import { handleManualGenerateBrief } from "@/lib/manual-generate-brief";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: Request) {
  return await handleManualGenerateBrief(request);
}
