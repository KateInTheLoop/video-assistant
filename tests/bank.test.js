import { test } from "node:test";
import assert from "node:assert/strict";
import { exportBank, importBank, mergeStories, normalizeLikely } from "../lib/bank.js";

const stories = [{ title: "Billing migration", situation: "s", action: "a", result: "r", tags: "impact", source: "cv" }];

test("export → import round-trips stories and likely questions", () => {
  const json = exportBank(stories, [{ q: "Why us?", story: null }, "Tell me about a failure"]);
  const out = importBank(json);
  assert.deepEqual(out.stories, stories);
  assert.deepEqual(out.likelyQuestions, [{ q: "Why us?", story: null }, { q: "Tell me about a failure", story: null }]);
});

test("import accepts a bare array and drops junk", () => {
  const out = importBank([{ title: "A", situation: 1, extra: "x" }, { nope: true }, null]);
  assert.deepEqual(out.stories, [{ title: "A", situation: "1" }]);
});

test("import rejects non-banks", () => {
  assert.throws(() => importBank('{"foo":1}'), /Not a story bank/);
});

test("merge skips duplicate titles", () => {
  const r = mergeStories(stories, [{ title: "billing migration" }, { title: "New one" }]);
  assert.equal(r.added, 1); assert.equal(r.skipped, 1); assert.equal(r.stories.length, 2);
});

test("normalizeLikely handles both shapes", () => {
  assert.deepEqual(normalizeLikely(["a", { q: "b", story: "S" }, { q: "" }]), [{ q: "a", story: null }, { q: "b", story: "S" }]);
});
