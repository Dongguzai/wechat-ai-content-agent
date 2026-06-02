import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { loadDotEnv } from "../src/config/env.js";
import { generateCoverWithReport } from "../src/pipeline/generateCover.js";

await loadDotEnv();

const outputDir = join(process.cwd(), "outputs");
const requestPath = join(outputDir, "cover-regenerate-request.json");

async function readRequest(): Promise<{ instruction: string }> {
  try {
    const content = await readFile(requestPath, "utf8");
    const payload = JSON.parse(content) as { instruction?: unknown };
    return {
      instruction: typeof payload.instruction === "string" ? payload.instruction : ""
    };
  } catch {
    return { instruction: "" };
  }
}

const request = await readRequest();
const existingStyle = process.env.APIMART_COVER_STYLE?.trim() ?? "";
const mergedStyle = [
  existingStyle,
  request.instruction
    ? `User cover revision request: ${request.instruction}`
    : "Regenerate the current cover with the existing safe visual direction."
]
  .filter(Boolean)
  .join("\n");

const result = await generateCoverWithReport({
  outputDir,
  env: {
    ...process.env,
    APIMART_COVER_STYLE: mergedStyle
  }
});

console.log(
  `[cover:regenerate] mode=${result.cover.mode}; provider=${result.cover.provider}; image=${result.cover.imagePath}`
);
console.log(`[cover:regenerate] reviewPassed=${result.review.passed}`);
