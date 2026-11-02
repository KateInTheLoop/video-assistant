import { test } from "node:test";
import assert from "node:assert/strict";
import { QuestionCaptureBuffer, captureShortcut, captureText, questionMode } from "../lib/questionCapture.js";

test("manual capture assembles final fragments with the latest live words", () => {
  const buffer = new QuestionCaptureBuffer();
  assert.equal(buffer.snapshot(), null);
  buffer.speech({ speaker: "interviewer", text: "Tell me about", final: true });
  buffer.speech({ speaker: "interviewer", text: "your work with queues" });
  const live = buffer.snapshot();
  assert.equal(live.text, "Tell me about your work with queues");
  buffer.speech({ speaker: "interviewer", text: "your work with queues?", final: true, speechFinal: true });
  assert.equal(buffer.snapshot().key, live.key);
  assert.equal(buffer.snapshot().text, "Tell me about your work with queues?");
});

test("pauses and speaker changes start a fresh capture while preserving the last question", () => {
  const buffer = new QuestionCaptureBuffer();
  buffer.speech({ speaker: "interviewer", text: "First question?", final: true });
  const first = buffer.snapshot();
  buffer.speech({ speaker: "candidate", text: "My answer", final: true });
  assert.deepEqual(buffer.snapshot(), first);
  buffer.speech({ speaker: "interviewer", text: "Second question?", final: true });
  assert.notEqual(buffer.snapshot().key, first.key);
  buffer.end();
  const second = buffer.snapshot();
  buffer.speech({ speaker: "interviewer", text: "And a follow-up?" });
  assert.notEqual(buffer.snapshot().key, second.key);
  buffer.reset(); assert.equal(buffer.snapshot(), null);
});

test("a delayed final retains the captured interim identity across another speaker or pause", () => {
  const buffer = new QuestionCaptureBuffer();
  buffer.speech({ speaker: "interviewer", text: "Can you explain retries" });
  const key = buffer.snapshot().key;
  buffer.speech({ speaker: "candidate", text: "Yes" }); buffer.end();
  buffer.speech({ speaker: "interviewer", text: "Can you explain retries?", final: true });
  assert.equal(buffer.snapshot().key, key);
  buffer.speech({ speaker: "interviewer", text: "A different question" });
  assert.notEqual(buffer.snapshot().key, key);
});

test("long noisy turns retain their latest words and empty results do not erase a question", () => {
  const buffer = new QuestionCaptureBuffer();
  buffer.speech({ speaker: "interviewer", text: "background ".repeat(600), final: true });
  buffer.speech({ speaker: "interviewer", text: "What is your actual question?", final: true });
  buffer.speech({ speaker: "interviewer", text: " " });
  assert.ok(buffer.snapshot().text.endsWith("What is your actual question?"));
  assert.ok(buffer.snapshot().text.length <= 4000);
  assert.equal(captureText(null), "");
  assert.equal(captureText("  a\n  question  "), "a question");
  assert.equal(questionMode("unknown"), "auto");
});

test("Space capture respects typing, native controls, modifiers, composition and key repeats", () => {
  const event = { key: " ", code: "Space", target: { tagName: "DIV" } };
  assert.equal(captureShortcut(event), true);
  for (const prop of ["repeat", "defaultPrevented", "isComposing", "altKey", "ctrlKey", "metaKey", "shiftKey"]) assert.equal(captureShortcut({ ...event, [prop]: true }), false, prop);
  for (const tagName of ["INPUT", "TEXTAREA", "SELECT", "BUTTON", "A", "SUMMARY"]) assert.equal(captureShortcut({ ...event, target: { tagName } }), false, tagName);
  assert.equal(captureShortcut({ ...event, target: { isContentEditable: true } }), false);
  assert.equal(captureShortcut({ ...event, target: { closest: () => ({}) } }), false);
  assert.equal(captureShortcut({ key: "Enter" }), false);
});
