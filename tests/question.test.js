import { test } from "node:test";
import assert from "node:assert/strict";
import { shouldAskForHint, PAUSE_DELAY_MS } from "../lib/question.js";

test("question mark asks immediately", () => {
  assert.deepEqual(shouldAskForHint({ text: "Tell me about a time you failed?" }), { ask: true, delayMs: 0 });
});

test("speech_final asks immediately", () => {
  assert.deepEqual(shouldAskForHint({ text: "Walk me through your last project", speechFinal: true }), { ask: true, delayMs: 0 });
});

test("mid-sentence waits for a pause", () => {
  assert.deepEqual(shouldAskForHint({ text: "So the next thing I wanted to" }), { ask: true, delayMs: PAUSE_DELAY_MS });
});

test("fillers and short fragments never ask", () => {
  for (const t of ["mm-hm", "Okay.", "Got it", "I see", "yeah"]) {
    assert.equal(shouldAskForHint({ text: t, speechFinal: true }).ask, false, t);
  }
});

test("pending text counts toward the word minimum", () => {
  assert.equal(shouldAskForHint({ text: "you?", pendingText: "" }).ask, false);
  assert.equal(shouldAskForHint({ text: "you?", pendingText: "How about" }).ask, true);
});
