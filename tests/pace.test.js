import { test } from "node:test";
import assert from "node:assert/strict";
import { answerStats, paceSummary } from "../lib/pace.js";

const L = (speaker, text, t) => ({ speaker, text, t });
const lines = [
  L("interviewer", "Tell me about yourself?", 0),
  L("candidate", "I am an engineer with ten years of experience building billing systems", 30_000),
  L("candidate", "and lately leading a small team", 50_000),
  L("interviewer", "Describe a failure?", 60_000),
  L("candidate", "Sure.", 65_000),
  L("interviewer", "Any questions for us?", 70_000),
  L("candidate", "Yes, what does onboarding look like here for a new lead on the team", 200_000),
];

test("groups candidate runs into answers with duration and flags", () => {
  const s = answerStats(lines, 220_000);
  assert.equal(s.length, 3);
  assert.equal(s[0].seconds, 60); assert.equal(s[0].words, 18); assert.equal(s[0].flag, "");
  assert.equal(s[1].seconds, 10); assert.equal(s[1].flag, "short");
  assert.equal(s[2].seconds, 150); assert.equal(s[2].flag, "long");
});

test("summary", () => {
  const sum = paceSummary(answerStats(lines, 220_000));
  assert.deepEqual(sum, { answers: 3, medianSeconds: 60, long: 1, short: 1 });
  assert.deepEqual(paceSummary([]), { answers: 0, medianSeconds: 0, long: 0, short: 0 });
});

test("interviewer lines without an answer are skipped", () => {
  assert.equal(answerStats([L("interviewer", "Hi?", 0), L("interviewer", "Hello?", 1000)], 2000).length, 0);
});
