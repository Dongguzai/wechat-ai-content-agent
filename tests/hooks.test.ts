import assert from "node:assert/strict";
import test from "node:test";
import { forbidAutoPublish } from "../src/hooks/forbidAutoPublish.js";
import {
  checkChineseNewsLanguage,
  requireChineseNewsLanguage
} from "../src/hooks/requireChineseNewsLanguage.js";
import { requireSourceUrl } from "../src/hooks/requireSourceUrl.js";

test("requireSourceUrl allows items with normal URLs", () => {
  assert.doesNotThrow(() =>
    requireSourceUrl({
      title: "AI news with source",
      url: "https://example.com/source"
    })
  );
});

test("requireSourceUrl rejects empty URLs", () => {
  assert.throws(
    () => requireSourceUrl({ title: "Missing URL", url: "" }),
    /missing source url/i
  );
});

test("requireSourceUrl rejects whitespace-only URLs", () => {
  assert.throws(
    () => requireSourceUrl({ title: "Blank URL", url: "   " }),
    /missing source url/i
  );
});

test("requireSourceUrl rejects missing URL fields", () => {
  assert.throws(
    () =>
      requireSourceUrl({
        title: "No URL field"
      } as { title: string; url: string }),
    /missing source url/i
  );
});

test("forbidAutoPublish rejects high-risk publish terms", () => {
  for (const term of ["群发", "发布", "确认发送", "立即发送"]) {
    assert.throws(
      () => forbidAutoPublish(`请${term}这篇文章`),
      /Forbidden outbound operation term detected/
    );
  }
});

test("forbidAutoPublish allows draft and preview operations", () => {
  assert.doesNotThrow(() => forbidAutoPublish("保存草稿"));
  assert.doesNotThrow(() => forbidAutoPublish("生成预览"));
});

test("requireChineseNewsLanguage allows Chinese text with fixed proper names", () => {
  assert.doesNotThrow(() =>
    requireChineseNewsLanguage({
      title: "OpenAI 发布 Codex 更新，Claude Code 工作流受到关注",
      snippet:
        "这条资讯保留 OpenAI、Codex、Claude Code 等固定专名，其余说明统一使用中文。",
      query: "今日 Codex 与 Claude Code 最新资讯"
    })
  );
});

test("checkChineseNewsLanguage flags untranslated English prose", () => {
  const result = checkChineseNewsLanguage({
    title: "OpenAI launches new agent workflow for developers",
    snippet: "The product adds workflow automation and enterprise controls."
  });

  assert.equal(result.passed, false);
  assert.ok(
    result.violations.some(
      (violation) =>
        violation.field === "title" &&
        violation.disallowedTerms.includes("launches")
    )
  );
  assert.ok(
    result.violations.some(
      (violation) =>
        violation.field === "snippet" &&
        violation.disallowedTerms.includes("workflow")
    )
  );
});
