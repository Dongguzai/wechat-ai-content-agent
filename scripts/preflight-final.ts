import { loadDotEnv } from "../src/config/env.js";
import { runFinalPreflight } from "../src/pipeline/finalPreflight.js";

await loadDotEnv();

const force = process.argv.includes("--force");

try {
  const result = await runFinalPreflight({
    env: process.env,
    force
  });

  console.log(
    `[preflight:final] ${result.passed ? "passed" : "blocked"}; result=${result.files.result}`
  );
  console.log(`[preflight:final] report=${result.files.report}`);

  if (!result.passed) {
    for (const issue of result.issues) {
      console.error(`[preflight:final] ${issue}`);
    }
    process.exitCode = 1;
  }
} catch (error) {
  const message = error instanceof Error ? error.message : "Unknown error.";
  console.error(`[preflight:final] blocked: ${message}`);
  process.exitCode = 1;
}
