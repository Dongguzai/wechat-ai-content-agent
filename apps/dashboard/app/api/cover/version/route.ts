import { NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth";
import { deleteCoverVersion, setCurrentCoverVersion } from "@/lib/editor-workflow";
import { redactJson } from "@/lib/redaction";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const authError = await requireApiSession();
  if (authError) return authError;

  try {
    const body = await request.json();
    const action = typeof body?.action === "string" ? body.action : "";
    const result =
      action === "set-current"
        ? await setCurrentCoverVersion(body)
        : action === "delete"
          ? await deleteCoverVersion(body)
          : undefined;

    if (!result) {
      return NextResponse.json({ ok: false, error: "Unsupported cover version action." }, { status: 400 });
    }

    return NextResponse.json(redactJson({ ok: true, ...result }));
  } catch (error) {
    return NextResponse.json(
      redactJson({
        ok: false,
        error: error instanceof Error ? error.message : "Cover version update failed."
      }),
      { status: 400 }
    );
  }
}
