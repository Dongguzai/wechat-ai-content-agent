import { NextResponse } from "next/server";
import { hasDashboardSession } from "@/lib/auth";
import { asObject, sanitizeBriefGenerationErrorMessage } from "@/lib/brief-generate-response";
import { generateCloudBriefForToday } from "@/lib/cloud-brief-server";
import { redactJson } from "@/lib/redaction";
import { getCloudBriefGenerationStep } from "../../../src/pipeline/generateCloudEditorialBrief";
import type { CloudBriefGenerationStep } from "../../../src/types/cloud";

export interface ManualGenerateBriefHandlerOptions {
  env?: NodeJS.ProcessEnv;
  generate?: (input: { force: boolean }) => Promise<unknown>;
  isAuthorized?: () => Promise<boolean>;
}

export async function handleManualGenerateBrief(
  request: Request,
  options: ManualGenerateBriefHandlerOptions = {}
) {
  const env = options.env ?? process.env;
  let currentStep: CloudBriefGenerationStep = "auth";
  const logStep = (step: CloudBriefGenerationStep) => {
    currentStep = step;
    console.log(`[dashboard.generate-brief] step=${step}`);
  };

  logStep("auth");

  const authorized = await (options.isAuthorized ? options.isAuthorized() : hasDashboardSession(env));
  if (!authorized) {
    return NextResponse.json(
      { ok: false, step: currentStep, error: "Unauthorized." },
      { status: 401 }
    );
  }

  const body = await request.json().catch(() => ({}));
  const force = isObject(body) && body.force === true;

  console.log(
    force
      ? "[dashboard.generate-brief] manual force run requested."
      : "[dashboard.generate-brief] manual run requested."
  );

  try {
    const generate =
      options.generate ??
      ((input: { force: boolean }) =>
        generateCloudBriefForToday(env, {
          force: input.force,
          runLabel: input.force ? "manual force run" : "manual run",
          onStep: logStep,
          sanitizeErrorMessage: (message) => sanitizeBriefGenerationErrorMessage(message, env)
        }));
    const result = await generate({ force });

    return NextResponse.json(redactJson({ ok: true, ...asObject(result) }));
  } catch (error) {
    const step = getCloudBriefGenerationStep(error) ?? currentStep;
    const message = sanitizeBriefGenerationErrorMessage(error, env);
    console.error(`[dashboard.generate-brief] failed step=${step} error=${message}`);

    return NextResponse.json(
      redactJson({
        ok: false,
        step,
        error: message
      }),
      { status: 500 }
    );
  }
}

function isObject(value: unknown): value is { force?: unknown } {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
