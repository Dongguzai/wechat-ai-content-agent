import { handleR2Health } from "@/lib/r2-health";

export const runtime = "nodejs";

export async function GET() {
  return await handleR2Health();
}
