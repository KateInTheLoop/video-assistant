import { test } from "node:test";
import assert from "node:assert/strict";
import { HintScheduler, MIN_GAP_MS } from "../lib/scheduler.js";

test("question mark fires immediately on a cold start", () => {
  const s = new HintScheduler();
  assert.deepEqual(s.onInterviewerFinal({ text: "Tell me about a failure?", speechFinal: false }, 1000), { fireInMs: 0 });
  assert.equal(s.take(1000), "Tell me about a failure?");
});

test("fragments coalesce into one request", () => {
  const s = new HintScheduler();
  s.onInterviewerFinal({ text: "So tell me about", speechFinal: false }, 0);
  s.onInterviewerFinal({ text: "a time you disagreed with your manager", speechFinal: true }, 500);
  assert.equal(s.take(500), "So tell me about a time you disagreed with your manager");
});

test("never fires twice within the minimum gap", () => {
  const s = new HintScheduler();
  s.onInterviewerFinal({ text: "First question here?", speechFinal: true }, 0);
  s.take(0); s.done(100);
  const r = s.onInterviewerFinal({ text: "And a follow-up question?", speechFinal: true }, 500);
  assert.equal(r.fireInMs, MIN_GAP_MS - 500);
  assert.equal(s.take(500), null, "gate blocks early fire");
  assert.equal(s.take(MIN_GAP_MS), "And a follow-up question?");
});

test("no overlap while a call is in flight; drains afterwards", () => {
  const s = new HintScheduler();
  s.onInterviewerFinal({ text: "Walk me through your resume?", speechFinal: true }, 0);
  s.take(0);
  s.onInterviewerFinal({ text: "Start with the most recent role?", speechFinal: true }, 1000);
  assert.equal(s.take(1000), null);
  const r = s.done(3000);
  assert.ok(r.fireInMs >= 300);
  assert.equal(s.take(3000 + r.fireInMs), "Start with the most recent role?");
});

test("fillers never schedule; candidate speaking clears pending", () => {
  const s = new HintScheduler();
  assert.equal(s.onInterviewerFinal({ text: "mm-hm", speechFinal: true }, 0), null);
  s.onInterviewerFinal({ text: "So the role is mostly", speechFinal: false }, 0);
  s.onCandidateSpeaks();
  assert.equal(s.onUtteranceEnd(2000), null);
});

test("explicit capture bypasses automatic delay but never overlaps an active request", () => {
  const scheduler = new HintScheduler();
  assert.equal(scheduler.takeManual("First selected question", 0), "First selected question");
  assert.equal(scheduler.takeManual("Second selected question", 1), null);
  scheduler.done(10);
  assert.equal(scheduler.takeManual("Second selected question", 11), "Second selected question");
});

test("queued automatic work retains its own capture identity across delayed requests", () => {
  const scheduler = new HintScheduler();
  scheduler.onInterviewerFinal({ text: "First question?", speechFinal: true, captureKey: "turn:1" }, 0);
  assert.equal(scheduler.take(0), "First question?");
  scheduler.onInterviewerFinal({ text: "A queued question?", speechFinal: true, captureKey: "turn:2" }, 100);
  assert.equal(scheduler.takenCaptureKey, "turn:1");
  scheduler.done(3000);
  assert.equal(scheduler.take(3000), "A queued question?");
  assert.equal(scheduler.takenCaptureKey, "turn:2");
});

test("same-turn fragments retain a key and mixed-turn batches cannot alias a single turn", () => {
  const scheduler = new HintScheduler();
  scheduler.onInterviewerFinal({ text: "Explain", captureKey: "turn:1" }, 0);
  scheduler.onInterviewerFinal({ text: "queue retries?", captureKey: "turn:1" }, 50);
  assert.equal(scheduler.take(100), "Explain queue retries?");
  assert.equal(scheduler.takenCaptureKey, "turn:1");
  scheduler.done(150);
  scheduler.onInterviewerFinal({ text: "Second question?", captureKey: "turn:2" }, 200);
  scheduler.onInterviewerFinal({ text: "Third question?", captureKey: "turn:3" }, 300);
  scheduler.take(3000);
  assert.equal(scheduler.takenCaptureKey, null);
});

test("discarding pending speech also discards its capture identity", () => {
  const scheduler = new HintScheduler();
  scheduler.onInterviewerFinal({ text: "An abandoned question?", captureKey: "turn:1" }, 0);
  scheduler.onCandidateSpeaks();
  assert.equal(scheduler.pendingCaptureKey, null);
  scheduler.onInterviewerFinal({ text: "A fresh question?", captureKey: "turn:2" }, 100);
  scheduler.take(100);
  assert.equal(scheduler.takenCaptureKey, "turn:2");
});
