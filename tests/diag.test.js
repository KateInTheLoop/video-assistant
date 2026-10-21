import { test } from "node:test";
import assert from "node:assert/strict";
import { makeEntry, pushEntry, summarize, DIAG_LIMIT } from "../lib/diag.js";

test("ring buffer caps at limit", () => {
  let l = [];
  for (let i = 0; i < DIAG_LIMIT + 10; i++) l = pushEntry(l, makeEntry({ ms: i, model: "m" }));
  assert.equal(l.length, DIAG_LIMIT);
  assert.equal(l[0].ms, 10);
});

test("summary gives median and cache hit rate over successful calls", () => {
  const l = [
    makeEntry({ ms: 900, model: "m", usage: { cache_read_input_tokens: 0 } }),
    makeEntry({ ms: 1500, model: "m", usage: { cache_read_input_tokens: 3000 } }),
    makeEntry({ ms: 1200, model: "m", usage: { cache_read_input_tokens: 3000 } }),
    makeEntry({ ms: 5000, model: "m", ok: false, error: "boom" }),
  ];
  const s = summarize(l);
  assert.equal(s.count, 3); assert.equal(s.medianMs, 1200); assert.ok(Math.abs(s.cacheHitRate - 2 / 3) < 1e-9);
});
