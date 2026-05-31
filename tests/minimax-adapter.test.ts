import assert from "node:assert/strict";
import test from "node:test";
import {
  createChatCompletion,
  minimaxChatCompletionsUrl
} from "../src/adapters/minimax.js";

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

test("minimaxChatCompletionsUrl appends chat completions endpoint", () => {
  assert.equal(
    minimaxChatCompletionsUrl("https://api.minimaxi.com/v1"),
    "https://api.minimaxi.com/v1/chat/completions"
  );
  assert.equal(
    minimaxChatCompletionsUrl("https://api.minimaxi.com/v1/chat/completions"),
    "https://api.minimaxi.com/v1/chat/completions"
  );
});

test("createChatCompletion posts OpenAI-compatible request body", async () => {
  const calls: Array<{ input: string | URL; init?: RequestInit }> = [];
  const fetchImpl = async (input: string | URL, init?: RequestInit): Promise<Response> => {
    calls.push({ input, init });
    return jsonResponse({
      choices: [
        {
          message: {
            content: "MiniMax response"
          },
          finish_reason: "stop"
        }
      ],
      usage: {
        prompt_tokens: 11,
        completion_tokens: 7,
        total_tokens: 18
      }
    });
  };

  const result = await createChatCompletion({
    env: {
      MINIMAX_API_KEY: "SECRET_MINIMAX_KEY",
      MINIMAX_BASE_URL: "https://api.minimaxi.com/v1",
      MINIMAX_MODEL: "MiniMax-M2.7"
    },
    fetchImpl,
    systemPrompt: "system",
    userPrompt: "user",
    temperature: 0.4,
    maxCompletionTokens: 123
  });

  assert.equal(String(calls[0].input), "https://api.minimaxi.com/v1/chat/completions");
  assert.equal((calls[0].init?.headers as Record<string, string>).Authorization, "Bearer SECRET_MINIMAX_KEY");

  const body = JSON.parse(String(calls[0].init?.body)) as Record<string, unknown>;
  assert.equal(body.model, "MiniMax-M2.7");
  assert.equal(body.temperature, 0.4);
  assert.equal(body.max_completion_tokens, 123);
  assert.deepEqual(body.messages, [
    { role: "system", content: "system" },
    { role: "user", content: "user" }
  ]);
  assert.equal(result.provider, "minimax");
  assert.equal(result.model, "MiniMax-M2.7");
  assert.equal(result.content, "MiniMax response");
  assert.deepEqual(result.usage, {
    promptTokens: 11,
    completionTokens: 7,
    totalTokens: 18
  });
});

test("createChatCompletion blocks real mode when MINIMAX_API_KEY is missing", async () => {
  await assert.rejects(
    () =>
      createChatCompletion({
        env: {
          MINIMAX_BASE_URL: "https://api.minimaxi.com/v1"
        },
        systemPrompt: "system",
        userPrompt: "user"
      }),
    /MINIMAX_API_KEY/
  );
});

test("createChatCompletion retries without response_format and normalizes JSON", async () => {
  const bodies: Record<string, unknown>[] = [];
  const fetchImpl = async (_input: string | URL, init?: RequestInit): Promise<Response> => {
    bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);

    if (bodies.length === 1) {
      return jsonResponse(
        { error: "response_format json_object not supported" },
        { status: 400, statusText: "Bad Request" }
      );
    }

    return jsonResponse({
      choices: [
        {
          message: {
            content: "Here is JSON: {\"ok\":true,\"items\":[1]}"
          },
          finish_reason: "stop"
        }
      ],
      usage: {}
    });
  };

  const result = await createChatCompletion({
    env: {
      MINIMAX_API_KEY: "SECRET_MINIMAX_KEY",
      MINIMAX_BASE_URL: "https://api.minimaxi.com/v1",
      MINIMAX_MODEL: "MiniMax-M2.7"
    },
    fetchImpl,
    userPrompt: "json please",
    responseFormat: "json_object"
  });

  assert.deepEqual(bodies[0].response_format, { type: "json_object" });
  assert.equal("response_format" in bodies[1], false);
  assert.equal(result.content, "{\"ok\":true,\"items\":[1]}");
});

test("createChatCompletion redacts MINIMAX_API_KEY from errors", async () => {
  const fetchImpl = async (): Promise<Response> =>
    new Response("SECRET_MINIMAX_KEY should not leak", {
      status: 500,
      statusText: "Server Error"
    });

  await assert.rejects(
    () =>
      createChatCompletion({
        env: {
          MINIMAX_API_KEY: "SECRET_MINIMAX_KEY",
          MINIMAX_BASE_URL: "https://api.minimaxi.com/v1"
        },
        fetchImpl,
        userPrompt: "hello"
      }),
    (error) => {
      assert.ok(error instanceof Error);
      assert.doesNotMatch(error.message, /SECRET_MINIMAX_KEY/);
      assert.match(error.message, /\[redacted\]/);
      return true;
    }
  );
});
