import { NextResponse } from "next/server";
import { sanitizeBriefGenerationErrorMessage } from "@/lib/brief-generate-response";
import {
  createR2Adapter,
  getR2ConfigDiagnostics,
  R2_UPLOAD_ENDPOINT_HINT,
  type R2StorageAdapter
} from "../../../src/adapters/r2";

export interface R2HealthHandlerOptions {
  env?: NodeJS.ProcessEnv;
  now?: Date;
  r2?: R2StorageAdapter;
}

export async function handleR2Health(options: R2HealthHandlerOptions = {}) {
  const env = options.env ?? process.env;
  const config = getR2ConfigDiagnostics(env);
  const timestamp = (options.now ?? new Date()).toISOString().replace(/[:.]/g, "-");
  const key = `health-check/${timestamp}.txt`;

  try {
    const r2 = options.r2 ?? createR2Adapter(env);
    await r2.putText({
      key,
      body: "ok",
      contentType: "text/plain; charset=utf-8"
    });

    return NextResponse.json({
      ok: true,
      step: "r2.putObject",
      config,
      message: "R2 write succeeded"
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        step: "r2.putObject",
        config,
        error: sanitizeBriefGenerationErrorMessage(error, env),
        endpointHint: R2_UPLOAD_ENDPOINT_HINT,
        message: "R2 write failed"
      },
      { status: 500 }
    );
  }
}
