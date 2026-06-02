import assert from "node:assert/strict";
import test from "node:test";
import { extractJsonFromText } from "../src/utils/extractJsonFromText.js";

test("extractJsonFromText parses pure JSON object", () => {
  const result = extractJsonFromText<{ title: string }>('{ "title": "结果" }');

  assert.equal(result.ok, true);
  assert.deepEqual(result.ok ? result.value : undefined, { title: "结果" });
});

test("extractJsonFromText parses markdown json code block", () => {
  const result = extractJsonFromText<{ title: string }>(
    '```json\n{ "title": "结果" }\n```'
  );

  assert.equal(result.ok, true);
  assert.equal(result.ok ? result.source : undefined, "json_code_block");
  assert.deepEqual(result.ok ? result.value : undefined, { title: "结果" });
});

test("extractJsonFromText parses plain code block", () => {
  const result = extractJsonFromText<{ title: string }>(
    '```\n{ "title": "结果" }\n```'
  );

  assert.equal(result.ok, true);
  assert.equal(result.ok ? result.source : undefined, "code_block");
  assert.deepEqual(result.ok ? result.value : undefined, { title: "结果" });
});

test("extractJsonFromText parses JSON object surrounded by explanatory text", () => {
  const result = extractJsonFromText<{ title: string }>(
    '好的，以下是结果：\n{ "title": "结果" }\n请查收。'
  );

  assert.equal(result.ok, true);
  assert.deepEqual(result.ok ? result.value : undefined, { title: "结果" });
});

test("extractJsonFromText parses JSON array", () => {
  const result = extractJsonFromText<Array<{ title: string }>>(
    '[\n  { "title": "结果" }\n]'
  );

  assert.equal(result.ok, true);
  assert.deepEqual(result.ok ? result.value : undefined, [{ title: "结果" }]);
});

test("extractJsonFromText ignores complete MiniMax think blocks before JSON", () => {
  const result = extractJsonFromText<{ title: string }>(
    '<think>这里可能包含 { "draft": false } 这样的思考文本。</think>\n{ "title": "结果" }'
  );

  assert.equal(result.ok, true);
  assert.deepEqual(result.ok ? result.value : undefined, { title: "结果" });
});

test("extractJsonFromText returns structured error when parsing fails", () => {
  const result = extractJsonFromText("不是 JSON");

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.message, "Text did not contain valid JSON content.");
    assert.equal(result.error.contentPreview, "不是 JSON");
    assert.ok(Array.isArray(result.error.attempts));
    assert.ok(result.error.attempts.length >= 1);
    assert.match(result.error.attempts[0].parseError, /Unexpected|token|JSON/i);
  }
});
