import { test } from "node:test";
import assert from "node:assert/strict";
import { interimBacklogMs, captionSummary } from "../lib/sttLatency.js";

test("measures interim cursor backlog and excludes deliberately early finals", () => {
  assert.equal(interimBacklogMs(2, { start: 1, duration: 0.75, is_final: false }), 250);
  assert.equal(interimBacklogMs(2, { start: 0, duration: 1, is_final: true }), null);
  assert.equal(interimBacklogMs(undefined, { start: 0, duration: 1 }), null);
  assert.equal(interimBacklogMs(1, { start: 0, duration: 20 }), null);
});

test("caption summary separates provider backlog from local DOM update duration", () => {
  const summary = captionSummary([{ backlogMs: 100, renderMs: 1 }, { backlogMs: 300, renderMs: 2 }, { backlogMs: 200, renderMs: 0.5 }, { backlogMs: null, renderMs: 3 }]);
  assert.deepEqual(summary, { samples: 3, medianBacklogMs: 200, p95BacklogMs: 300, maxRenderMs: 3 });
  assert.deepEqual(captionSummary(), { samples: 0, medianBacklogMs: null, p95BacklogMs: null, maxRenderMs: null });
});
