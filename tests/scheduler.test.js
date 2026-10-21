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
