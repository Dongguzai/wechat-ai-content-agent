import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  loadDotEnv,
  miniMaxDotEnvOverrideKeys
} from "../src/config/env.js";
import { resolveLlmStageConfig } from "../src/adapters/llm.js";
import { createChatCompletion } from "../src/adapters/minimax.js";

await loadDotEnv({ overrideKeys: [...miniMaxDotEnvOverrideKeys] });

const outputDir = join(process.cwd(), "outputs");
const requestPath = join(outputDir, "article-rewrite-request.json");
const resultPath = join(outputDir, "article-rewrite-result.json");

interface RewriteRequest {
  content: string;
  instruction: string;
}

async function readRequest(): Promise<RewriteRequest> {
  const content = await readFile(requestPath, "utf8");
  const payload = JSON.parse(content) as { content?: unknown; instruction?: unknown };
  const article = typeof payload.content === "string" ? payload.content : "";
  const instruction = typeof payload.instruction === "string" ? payload.instruction : "";

  if (!article.trim()) {
    throw new Error("article rewrite content is required.");
  }
  if (!instruction.trim()) {
    throw new Error("article rewrite instruction is required.");
  }

  return { content: article, instruction };
}

const request = await readRequest();
const config = resolveLlmStageConfig("article-writer", process.env);
const result =
  config.mode === "real"
    ? await rewriteWithMiniMax(request)
    : {
        rewrittenArticle: [
          request.content.trim(),
          "",
          `> AI 修改建议已记录：${request.instruction.trim()}`
        ].join("\n"),
        llm: {
          provider: config.provider,
          model: config.model,
          mode: "mock"
        }
      };

await mkdir(outputDir, { recursive: true });
await writeFile(resultPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");

console.log(`[article:rewrite] mode=${result.llm.mode}; result=${resultPath}`);

async function rewriteWithMiniMax(request: RewriteRequest) {
  const completion = await createChatCompletion({
    model: config.model,
    temperature: Math.min(config.temperature, 0.7),
    maxCompletionTokens: config.maxCompletionTokens,
    env: process.env,
    systemPrompt: [
      "你是微信公众号文章编辑，只能返回修改后的完整 Markdown 正文。",
      "保留事实边界，不新增未经证实的信息。",
      "不得加入发布、群发、确认发送、立即发送等公众号操作内容。"
    ].join("\n"),
    userPrompt: [
      "请按用户修改建议重写下方完整文章。",
      "",
      `修改建议：${request.instruction.trim()}`,
      "",
      "文章：",
      request.content
    ].join("\n")
  });

  return {
    rewrittenArticle: completion.content.trim(),
    llm: {
      provider: completion.provider,
      model: completion.model,
      mode: "real",
      usage: completion.usage,
      generatedAt: completion.generatedAt
    }
  };
}
