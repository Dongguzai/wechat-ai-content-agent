import assert from "node:assert/strict";
import test from "node:test";
import {
  minimaxSmokeCli,
  runMiniMaxSmoke
} from "../scripts/minimax-smoke.js";

function jsonResponse(value: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(value), {
    status: init.status ?? 200,
    statusText: init.statusText,
    headers: {
      "Content-Type": "application/json",
      ...(init.headers ?? {})
    }
  });
}

function smokeEnv(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    LLM_ENABLE_REAL_API: "true",
    MINIMAX_API_KEY: "SECRET_MINIMAX_KEY",
    MINIMAX_BASE_URL: "https://api.minimaxi.com/v1",
    MINIMAX_MODEL: "minimax-m3-test",
    ...overrides
  };
}

test("MiniMax smoke calls chat completions exactly once", async () => {
  const calls: Array<{ input: string | URL; init?: RequestInit }> = [];

  const result = await runMiniMaxSmoke({
    env: smokeEnv(),
    fetchImpl: async (input, init) => {
      calls.push({ input, init });

      return jsonResponse({
        choices: [
          {
            message: {
              content: "AI 编码代理是能理解任务并协助完成代码工作的智能助手。"
            },
            finish_reason: "stop"
          }
        ],
        usage: {
          prompt_tokens: 12,
          completion_tokens: 16,
          total_tokens: 28
        }
      });
    }
  });

  assert.equal(calls.length, 1);
  assert.equal(
    String(calls[0].input),
    "https://api.minimaxi.com/v1/chat/completions"
  );
  assert.equal((calls[0].init?.headers as Record<string, string>).Authorization, "Bearer SECRET_MINIMAX_KEY");

  const body = JSON.parse(String(calls[0].init?.body)) as Record<string, unknown>;
  assert.equal(body.model, "minimax-m3-test");
  assert.equal(body.max_completion_tokens, 80);
  assert.deepEqual(body.messages, [
    { role: "user", content: "用一句中文说明 AI 编码代理是什么。" }
  ]);

  const url = String(calls[0].input);
  assert.equal(url.includes("apimart"), false);
  assert.equal(url.includes("api.weixin.qq.com"), false);
  assert.equal(url.includes("draft/add"), false);
  assert.equal(url.includes("freepublish"), false);
  assert.equal(url.includes("mass"), false);
  assert.equal(url.includes("sendall"), false);
  assert.equal(result.provider, "minimax");
  assert.equal(result.model, "minimax-m3-test");
  assert.equal(
    result.contentPreview,
    "AI 编码代理是能理解任务并协助完成代码工作的智能助手。"
  );
  assert.deepEqual(result.usage, {
    promptTokens: 12,
    completionTokens: 16,
    totalTokens: 28
  });
});

test("MiniMax smoke blocks when LLM_ENABLE_REAL_API is not true", async () => {
  let fetchCalled = false;

  await assert.rejects(
    () =>
      runMiniMaxSmoke({
        env: smokeEnv({ LLM_ENABLE_REAL_API: "false" }),
        fetchImpl: async () => {
          fetchCalled = true;
          throw new Error("fetch should not be called");
        }
      }),
    /LLM_ENABLE_REAL_API=true/
  );
  assert.equal(fetchCalled, false);
});

test("MiniMax smoke blocks missing key before fetch and does not print secrets", async () => {
  const stdout: string[] = [];
  const stderr: string[] = [];
  let fetchCalled = false;

  const exitCode = await minimaxSmokeCli({
    env: smokeEnv({ MINIMAX_API_KEY: "" }),
    stdout: (message) => stdout.push(message),
    stderr: (message) => stderr.push(message),
    fetchImpl: async () => {
      fetchCalled = true;
      throw new Error("fetch should not be called");
    }
  });
  const combinedOutput = [...stdout, ...stderr].join("\n");

  assert.equal(exitCode, 1);
  assert.equal(fetchCalled, false);
  assert.deepEqual(stdout, []);
  assert.match(combinedOutput, /MINIMAX_API_KEY is required/);
  assert.doesNotMatch(combinedOutput, /SECRET_MINIMAX_KEY/);
  assert.doesNotMatch(combinedOutput, /Bearer/);
});

test("MiniMax smoke CLI prints safe summary and redacts key from content", async () => {
  const stdout: string[] = [];
  const stderr: string[] = [];

  const exitCode = await minimaxSmokeCli({
    env: smokeEnv(),
    stdout: (message) => stdout.push(message),
    stderr: (message) => stderr.push(message),
    fetchImpl: async () =>
      jsonResponse({
        choices: [
          {
            message: {
              content: "SECRET_MINIMAX_KEY should never appear in output."
            },
            finish_reason: "stop"
          }
        ],
        usage: {
          prompt_tokens: 1,
          completion_tokens: 2,
          total_tokens: 3
        }
      })
  });
  const combinedOutput = [...stdout, ...stderr].join("\n");

  assert.equal(exitCode, 0);
  assert.deepEqual(stderr, []);
  assert.match(combinedOutput, /provider: minimax/);
  assert.match(combinedOutput, /model: minimax-m3-test/);
  assert.match(combinedOutput, /content preview: \[redacted\]/);
  assert.match(
    combinedOutput,
    /usage: promptTokens=1, completionTokens=2, totalTokens=3/
  );
  assert.doesNotMatch(combinedOutput, /SECRET_MINIMAX_KEY/);
});

test("MiniMax smoke CLI explains 401 invalid api key without leaking the key", async () => {
  const stdout: string[] = [];
  const stderr: string[] = [];

  const exitCode = await minimaxSmokeCli({
    env: smokeEnv(),
    stdout: (message) => stdout.push(message),
    stderr: (message) => stderr.push(message),
    fetchImpl: async () =>
      jsonResponse(
        {
          error: {
            code: 2049,
            message: "invalid api key: SECRET_MINIMAX_KEY"
          }
        },
        {
          status: 401,
          statusText: "Unauthorized"
        }
      )
  });
  const combinedOutput = [...stdout, ...stderr].join("\n");

  assert.equal(exitCode, 1);
  assert.deepEqual(stdout, []);
  assert.match(combinedOutput, /MiniMax 401 invalid api key \(2049\)/);
  assert.match(
    combinedOutput,
    /如果使用国际站 key，尝试 MINIMAX_BASE_URL=https:\/\/api\.minimax\.io\/v1/
  );
  assert.match(
    combinedOutput,
    /如果使用国内站 key，尝试 MINIMAX_BASE_URL=https:\/\/api\.minimaxi\.com\/v1/
  );
  assert.match(combinedOutput, /Token Plan Key 和 Open Platform Key 是否混用/);
  assert.match(combinedOutput, /key 是否 active/);
  assert.match(combinedOutput, /\.env 是否有中文引号、空格或复制错误/);
  assert.match(combinedOutput, /\[redacted\]/);
  assert.doesNotMatch(combinedOutput, /SECRET_MINIMAX_KEY/);
});
