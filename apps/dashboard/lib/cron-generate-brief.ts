import { NextResponse } from "next/server";
import { verifyBearerToken } from "@/lib/auth";
import { asObject, sanitizeBriefGenerationErrorMessage } from "@/lib/brief-generate-response";
import { generateCloudBriefForToday } from "@/lib/cloud-brief-server";
import { redactJson } from "@/lib/redaction";
import { R2_UPLOAD_ENDPOINT_HINT, R2_UPLOAD_FAILURE_HINT } from "../../../src/adapters/r2";
import { getCloudBriefGenerationStep } from "../../../src/pipeline/generateCloudEditorialBrief";
import type { CloudBriefGenerationStep } from "../../../src/types/cloud";

export interface CronGenerateBriefHandlerOptions {
  env?: NodeJS.ProcessEnv;
  generate?: () => Promise<unknown>;
}

export async function handleCronGenerateBrief(
  request: Request,
  options: CronGenerateBriefHandlerOptions = {}
) {
  const env = options.env ?? process.env;
  const cronSecret = env.CRON_SECRET?.trim();
  let currentStep: CloudBriefGenerationStep = "auth";
  const logStep = (step: CloudBriefGenerationStep) => {
    currentStep = step;
    console.log(`[cron.generate-brief] step=${step}`);
  };

  logStep("auth");

  if (!cronSecret) {
    return NextResponse.json(
      { ok: false, step: currentStep, error: "Cron credential is not configured." },
      { status: 500 }
    );
  }

  if (!verifyBearerToken(request.headers.get("authorization"), cronSecret)) {
    return NextResponse.json(
      { ok: false, step: currentStep, error: "Unauthorized." },
      { status: 401 }
    );
  }

  try {
    const result = await (options.generate ??
      (() =>
        generateCloudBriefForToday(env, {
          onStep: logStep,
          sanitizeErrorMessage: (message) => sanitizeBriefGenerationErrorMessage(message, env)
        })))();
    return NextResponse.json(redactJson({ ok: true, ...asObject(result) }));
  } catch (error) {
    const step = getCloudBriefGenerationStep(error) ?? currentStep;
    const message = sanitizeBriefGenerationErrorMessage(error, env);
    console.error(`[cron.generate-brief] failed step=${step} error=${message}`);

    const r2Hint =
      step === "r2.uploadBriefReport"
        ? {
            hint: R2_UPLOAD_FAILURE_HINT,
            endpointHint: R2_UPLOAD_ENDPOINT_HINT
          }
        : {};

    return NextResponse.json(
      redactJson({
        ok: false,
        step,
        error: message,
        ...r2Hint
      }),
      { status: 500 }
    );
  }
}
