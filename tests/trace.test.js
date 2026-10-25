import { test } from "node:test";
import assert from "node:assert/strict";
import { createTrace, formatTrace } from "../lib/trace.js";

test("marks are relative to session start, capped, and measurable", () => {
  let t = 1000;
  const seen = [];
  const tr = createTrace({ now: () => t, max: 3, onMark: (e) => seen.push(e.event) });
  t = 1250; tr.mark("stt.final", { speaker: "interviewer", chars: 40 });
  t = 1300; tr.mark("hint.request");
  assert.equal(tr.since("stt.final"), 50);
  assert.equal(tr.since("nope"), null);
  t = 1400; tr.mark("hint.ttft"); tr.mark("hint.done", { ms: 100 });
  assert.equal(tr.entries.length, 3, "ring buffer caps");
  assert.deepEqual(seen, ["stt.final", "hint.request", "hint.ttft", "hint.done"]);
  tr.reset();
  assert.equal(tr.entries.length, 0);
});

test("format is one grep-friendly line per entry", () => {
  const out = formatTrace([{ t: 250, event: "stt.final", speaker: "interviewer", chars: 40 }, { t: 2364, event: "hint.done", cached: true }]);
  assert.equal(out, '+   250ms stt.final speaker="interviewer" chars=40\n+  2364ms hint.done cached=true');
});
