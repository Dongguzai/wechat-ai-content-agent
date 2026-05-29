import assert from "node:assert/strict";
import test from "node:test";
import { forbidAutoPublish } from "../src/hooks/forbidAutoPublish.js";
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
