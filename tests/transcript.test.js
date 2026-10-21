import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeFinal, recent, MERGE_WINDOW_MS } from "../lib/transcript.js";

test("merges same speaker within window", () => {
  const t = [];
  mergeFinal(t, { speaker: "interviewer", text: "Tell me about" }, 1000);
  mergeFinal(t, { speaker: "interviewer", text: "a time you failed." }, 2500);
  assert.equal(t.length, 1);
  assert.equal(t[0].text, "Tell me about a time you failed.");
});

test("does not merge across speakers", () => {
  const t = [];
  mergeFinal(t, { speaker: "interviewer", text: "Hi." }, 1000);
  mergeFinal(t, { speaker: "candidate", text: "Hello." }, 1500);
  assert.equal(t.length, 2);
});

test("does not merge after the window", () => {
  const t = [];
  mergeFinal(t, { speaker: "candidate", text: "First." }, 1000);
  mergeFinal(t, { speaker: "candidate", text: "Second." }, 1000 + MERGE_WINDOW_MS + 1);
  assert.equal(t.length, 2);
});

test("recent renders last n lines with speaker labels", () => {
  const t = [];
  for (let i = 0; i < 20; i++) mergeFinal(t, { speaker: i % 2 ? "candidate" : "interviewer", text: `line ${i}` }, i * 10000);
  const out = recent(t, 3).split("\n");
  assert.equal(out.length, 3);
  assert.equal(out[2], "CANDIDATE: line 19");
});
