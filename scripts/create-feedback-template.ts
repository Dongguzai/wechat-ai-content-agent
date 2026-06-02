import { createFeedbackTemplate } from "../src/pipeline/createFeedbackTemplate.js";

try {
  const result = await createFeedbackTemplate();

  console.log(`[feedback:new] created=${result.filePath}`);
  console.log(`[feedback:new] source=${result.sourceDir}`);
} catch (error) {
  const message = error instanceof Error ? error.message : "Unknown error.";
  console.error(`[feedback:new] blocked: ${message}`);
  process.exitCode = 1;
}
