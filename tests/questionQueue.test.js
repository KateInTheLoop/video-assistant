import { test } from "node:test";
import assert from "node:assert/strict";
import { shouldSupersede, queueOrder, SUPERSEDE_MS } from "../lib/questionQueue.js";

const NOW = 1_000_000;
const last = (over = {}) => ({ id: 1, at: NOW - 3000, status: "new", ...over });
const hint = (over = {}) => ({ question_summary: "Walk me through your resume", follow_up: false, ...over });

test("a sharper reading of the same question replaces the pending entry", () => {
  assert.equal(shouldSupersede({ last: last(), hint: hint(), now: NOW, lastCandidateAt: 0 }), true);
});

test("nothing to supersede when the queue is empty", () => {
  assert.equal(shouldSupersede({ last: undefined, hint: hint(), now: NOW }), false);
});

test("a question the candidate already triaged is never overwritten", () => {
  for (const status of ["answering", "later", "dismissed"]) {
    assert.equal(shouldSupersede({ last: last({ status }), hint: hint(), now: NOW }), false, status);
  }
});

test("a follow-up gets its own entry", () => {
  assert.equal(shouldSupersede({ last: last(), hint: hint({ follow_up: true }), now: NOW }), false);
});

test("once the candidate has answered, the next question is a new one", () => {
  assert.equal(shouldSupersede({ last: last(), hint: hint(), now: NOW, lastCandidateAt: NOW - 1000 }), false);
});

test("a long silence means a genuinely new question", () => {
  assert.equal(shouldSupersede({ last: last({ at: NOW - SUPERSEDE_MS - 1 }), hint: hint(), now: NOW }), false);
});

test("dismissed questions sink below live ones, each group newest first", () => {
  const qs = [
    { id: 1, status: "new" },
    { id: 2, status: "dismissed" },
    { id: 3, status: "answering" },
    { id: 4, status: "dismissed" },
  ];
  assert.deepEqual(queueOrder(qs).map((q) => q.id), [3, 1, 4, 2]);
});
