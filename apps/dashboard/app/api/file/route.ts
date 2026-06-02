import { NextRequest, NextResponse } from "next/server";
import { readFileForApi } from "@/lib/dashboard-data";
import { redactJson } from "@/lib/redaction";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const requestedPath = request.nextUrl.searchParams.get("path") ?? "";
  const raw = request.nextUrl.searchParams.get("raw") === "1";

  try {
    const file = await readFileForApi(requestedPath);
    if (raw) {
      const body =
        file.encoding === "base64"
          ? Buffer.from(file.content, "base64")
          : file.content;
      return new Response(body, {
        headers: {
          "content-type": file.contentType,
          "x-dashboard-path": file.path
        }
      });
    }

    const { absolutePath: _absolutePath, ...safeFile } = file;
    return NextResponse.json(redactJson(safeFile));
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "File read failed."
      },
      { status: 403 }
    );
  }
}
