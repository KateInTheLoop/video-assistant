import { test } from "node:test";
import assert from "node:assert/strict";
import { STANDARD_QUESTIONS, STORY_FROM_ANSWER_SCHEMA, nextIndex } from "../lib/storyInterview.js";

test("ten questions, unique tags, failure and conflict included", () => {
  assert.equal(STANDARD_QUESTIONS.length, 10);
  const tags = STANDARD_QUESTIONS.map((q) => q.tag);
  assert.equal(new Set(tags).size, 10);
  assert.ok(tags.includes("failure") && tags.includes("conflict"));
});

test("nextIndex skips covered tags and returns -1 when complete", () => {
  assert.equal(nextIndex([]), 0);
  assert.equal(nextIndex([{ source: "interview", interviewTag: "failure" }]), 1);
  assert.equal(nextIndex([{ source: "cv", interviewTag: "failure" }]), 0, "CV stories do not count as interview coverage");
  assert.equal(nextIndex(STANDARD_QUESTIONS.map((q) => ({ source: "interview", interviewTag: q.tag }))), -1);
});

test("schema is strict", () => {
  assert.equal(STORY_FROM_ANSWER_SCHEMA.additionalProperties, false);
  assert.deepEqual(STORY_FROM_ANSWER_SCHEMA.required.sort(), Object.keys(STORY_FROM_ANSWER_SCHEMA.properties).sort());
});
