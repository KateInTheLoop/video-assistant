import { test } from "node:test";
import assert from "node:assert/strict";
import { buildHintRequest, lastHintText } from "../lib/hintRequest.js";

const ctx = { model: "claude-opus-5-5", stories: [{ title: "A", situation: "s", action: "a", result: "r" }], jobDescription: "JD", cvText: "CV" };

test("stable context sits before the cache breakpoint; transcript only in messages", () => {
  const a = buildHintRequest({ ...ctx, transcript: [{ speaker: "interviewer", text: "Tell me about A?", t: 1 }] });
  const b = buildHintRequest({ ...ctx, transcript: [{ speaker: "interviewer", text: "Different question?", t: 2 }] });
  assert.deepEqual(a.system, b.system, "system prefix must not change between hint calls");
  assert.deepEqual(a.system.at(-1).cache_control, { type: "ephemeral" });
  assert.notEqual(a.messages[0].content, b.messages[0].content);
  assert.match(a.messages[0].content, /Tell me about A\?/);
  assert.doesNotMatch(JSON.stringify(a.system), /Tell me about A/);
});

test("uses structured output with the hint schema and low effort", () => {
  const r = buildHintRequest({ ...ctx, transcript: [] });
  assert.equal(r.output_config.format.type, "json_schema");
  assert.equal(r.output_config.effort, "low");
  assert.equal(r.fallbacks, "default");
});

test("last hint goes into the user message, never the cached system prefix", () => {
  const lastHint = { is_question: true, question_summary: "Conflict with manager", question_type: "behavioral", stories: [{ title: "A", cue: "c" }], keywords: ["listen", "data"] };
  const a = buildHintRequest({ ...ctx, transcript: [], lastHint });
  const b = buildHintRequest({ ...ctx, transcript: [], lastHint: null });
  assert.deepEqual(a.system, b.system);
  assert.match(a.messages[0].content, /Conflict with manager .*stories: A; keywords: listen, data/);
  assert.match(b.messages[0].content, /Previous hint shown to the candidate: \(none\)/);
  assert.equal(lastHintText({ is_question: false }), "(none)");
});
