import { test } from "node:test";
import assert from "node:assert/strict";
import { layoutPreferences, layoutVisibility, splitBounds, clampSplit } from "../lib/layout.js";

test("unknown and malformed display preferences retain usable defaults", () => {
  for (const saved of [null, false, [], "bad", { selected: { toString: 1, valueOf: 2 } }, { selected: "__proto__", fontSize: 99, views: { text: { left: "50", video: null, call: "false", transcript: 0 } } }]) {
    const prefs = layoutPreferences(saved);
    assert.equal(prefs.selected, "text");
    assert.equal(prefs.fontSize, 16);
    assert.deepEqual(prefs.views.text, { left: 50, video: 26, call: true, transcript: true });
  }
});

test("saved splits are bounded, presets stay independent and returned defaults are not shared", () => {
  const prefs = layoutPreferences({ selected: "whiteboard", fontSize: 20, views: { text: { left: 500, video: -500, call: false, transcript: false } } });
  assert.equal(prefs.selected, "whiteboard");
  assert.equal(prefs.fontSize, 20);
  assert.deepEqual(prefs.views.text, { left: 70, video: 15, call: false, transcript: false });
  assert.equal(prefs.views.whiteboard.left, 64);
  prefs.views.whiteboard.left = 30;
  assert.equal(layoutPreferences().views.whiteboard.left, 64);
});

test("divider limits leave space for readable panes and relax on short surfaces", () => {
  for (const width of [900, 1024, 1280, 1920]) {
    const bounds = splitBounds(width, "left");
    assert.ok(clampSplit(0, bounds) / 100 * width >= 300 - .001);
    assert.ok(width - clampSplit(100, bounds) / 100 * width - 10 >= 400 - .001);
  }
  for (const height of [246, 400, 800]) {
    const bounds = splitBounds(height, "video");
    assert.ok(clampSplit(0, bounds) / 100 * height >= 96 - .001);
    assert.ok(height - clampSplit(100, bounds) / 100 * height - 10 >= 140 - .001);
  }
  assert.deepEqual(splitBounds(100, "video"), { min: 15, max: 80 });
  assert.deepEqual(splitBounds(NaN, "left"), { min: 25, max: 70 });
});

test("hidden or ended video never hides live captions in the new presets", () => {
  for (const selected of ["text", "whiteboard"]) {
    const view = layoutPreferences().views[selected];
    for (const hasVideo of [true, false]) for (const call of [true, false]) {
      const visible = layoutVisibility({ selected, view: { ...view, call }, hasVideo });
      assert.equal(visible.media, true);
      assert.equal(visible.transcript, true);
      assert.equal(visible.call, call && hasVideo);
      assert.equal(visible.rowDivider, call && hasVideo);
    }
    assert.equal(layoutVisibility({ selected, view: { ...view, call: false, transcript: false }, hasVideo: true }).media, false);
  }
});

test("Current keeps captions with the coach and gives it full width without a picture", () => {
  const view = layoutPreferences().views.current;
  const visible = layoutVisibility({ selected: "current", view, hasVideo: false });
  assert.equal(visible.media, false);
  assert.equal(visible.transcript, true);
  assert.equal(visible.transcriptInCoach, true);
  assert.equal(visible.rowDivider, false);
});
