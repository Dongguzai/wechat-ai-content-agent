import assert from "node:assert/strict";
import test from "node:test";
import {
  minimaxModelsCli,
  minimaxModelsUrl,
  runMiniMaxModels
} from "../scripts/list-minimax-models.js";

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

function modelsEnv(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    MINIMAX_API_KEY: "SECRET_MINIMAX_KEY",
    MINIMAX_BASE_URL: "https://api.minimaxi.com/v1",
    MINIMAX_MODEL: "minimax-m3-test",
    ...overrides
  };
}

test("minimaxModelsUrl appends models endpoint", () => {
  assert.equal(
    minimaxModelsUrl("https://api.minimaxi.com/v1"),
    "https://api.minimaxi.com/v1/models"
  );
  assert.equal(
    minimaxModelsUrl("https://api.minimaxi.com/v1/"),
    "https://api.minimaxi.com/v1/models"
  );
  assert.equal(
    minimaxModelsUrl("https://api.minimaxi.com/v1/models"),
    "https://api.minimaxi.com/v1/models"
  );
  assert.equal(
    minimaxModelsUrl("https://api.minimaxi.com/v1/chat/completions"),
    "https://api.minimaxi.com/v1/models"
  );
});

test("runMiniMaxModels calls models endpoint exactly once", async () => {
  const calls: Array<{ input: string | URL; init?: RequestInit }> = [];

  const result = await runMiniMaxModels({
    env: modelsEnv(),
    fetchImpl: async (input, init) => {
      calls.push({ input, init });

      return jsonResponse({
        object: "list",
        data: [
          { id: "minimax-m3-test" },
          { id: "MiniMax-Text-01" },
          { id: "minimax-m3-test" }
        ]
      });
    }
  });

  assert.equal(calls.length, 1);
  assert.equal(String(calls[0].input), "https://api.minimaxi.com/v1/models");
  assert.equal(
    (calls[0].init?.headers as Record<string, string>).Authorization,
    "Bearer SECRET_MINIMAX_KEY"
  );
  assert.equal(calls[0].init?.method, "GET");

  const url = String(calls[0].input);
  assert.equal(url.includes("chat/completions"), false);
  assert.equal(url.includes("apimart"), false);
  assert.equal(url.includes("api.weixin.qq.com"), false);
  assert.equal(url.includes("draft/add"), false);
  assert.equal(url.includes("freepublish"), false);
  assert.equal(url.includes("mass"), false);
  assert.equal(url.includes("sendall"), false);
  assert.deepEqual(result.modelIds, ["minimax-m3-test", "MiniMax-Text-01"]);
});

test("MiniMax models CLI prints model ids without leaking key", async () => {
  const stdout: string[] = [];
  const stderr: string[] = [];

  const exitCode = await minimaxModelsCli({
    env: modelsEnv(),
    stdout: (message) => stdout.push(message),
    stderr: (message) => stderr.push(message),
    fetchImpl: async () =>
      jsonResponse({
        data: [
          { id: "minimax-m3-test" },
          { id: "MiniMax-Text-01" }
        ]
      })
  });
  const combinedOutput = [...stdout, ...stderr].join("\n");

  assert.equal(exitCode, 0);
  assert.deepEqual(stderr, []);
  assert.match(combinedOutput, /modelsUrl: https:\/\/api\.minimaxi\.com\/v1\/models/);
  assert.match(combinedOutput, /model count: 2/);
  assert.match(combinedOutput, /- minimax-m3-test/);
  assert.match(combinedOutput, /- MiniMax-Text-01/);
  assert.doesNotMatch(combinedOutput, /SECRET_MINIMAX_KEY/);
  assert.doesNotMatch(combinedOutput, /Bearer/);
});

test("MiniMax models CLI warns when MINIMAX_MODEL is not returned", async () => {
  const stdout: string[] = [];
  const stderr: string[] = [];

  const exitCode = await minimaxModelsCli({
    env: modelsEnv({ MINIMAX_MODEL: "minimax-m3-missing" }),
    stdout: (message) => stdout.push(message),
    stderr: (message) => stderr.push(message),
    fetchImpl: async () =>
      jsonResponse({
        data: [{ id: "minimax-m3-test" }]
      })
  });
  const combinedOutput = [...stdout, ...stderr].join("\n");

  assert.equal(exitCode, 0);
  assert.match(combinedOutput, /warning: MINIMAX_MODEL=minimax-m3-missing/);
  assert.doesNotMatch(combinedOutput, /SECRET_MINIMAX_KEY/);
});

test("MiniMax models CLI explains 401 without leaking full key", async () => {
  const stdout: string[] = [];
  const stderr: string[] = [];

  const exitCode = await minimaxModelsCli({
    env: modelsEnv(),
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
  assert.match(combinedOutput, /MiniMax 401 Unauthorized 排查建议/);
  assert.match(combinedOutput, /按量计费 API Key 是否有效/);
  assert.match(combinedOutput, /国内站 key 是否使用 https:\/\/api\.minimaxi\.com\/v1/);
  assert.match(combinedOutput, /国际站 key 是否使用 https:\/\/api\.minimax\.io\/v1/);
  assert.match(combinedOutput, /key 是否 active/);
  assert.match(combinedOutput, /\[redacted\]/);
  assert.doesNotMatch(combinedOutput, /SECRET_MINIMAX_KEY/);
  assert.doesNotMatch(combinedOutput, /Bearer/);
});

test("MiniMax models CLI blocks missing key before fetch", async () => {
  const stdout: string[] = [];
  const stderr: string[] = [];
  let fetchCalled = false;

  const exitCode = await minimaxModelsCli({
    env: modelsEnv({ MINIMAX_API_KEY: "" }),
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
