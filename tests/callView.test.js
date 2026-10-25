import { test } from "node:test";
import assert from "node:assert/strict";
import { callTracks, showCallPane, stageLayout, STACK_BELOW_PX } from "../lib/callView.js";

const fakeStream = (kinds) => ({
  getAudioTracks: () => kinds.filter((k) => k === "audio").map((k) => ({ kind: k })),
  getVideoTracks: () => kinds.filter((k) => k === "video").map((k) => ({ kind: k })),
});

test("a tab share yields both tracks; an audio-only share yields no picture", () => {
  const both = callTracks(fakeStream(["video", "audio"]));
  assert.equal(both.audio.kind, "audio");
  assert.equal(both.video.kind, "video");
  const audioOnly = callTracks(fakeStream(["audio"]));
  assert.equal(audioOnly.video, null);
  assert.deepEqual(callTracks(null), { audio: null, video: null });
});

test("the call pane shows only with a live picture and not when the user hid it", () => {
  assert.equal(showCallPane({ hasVideo: true }), true);
  assert.equal(showCallPane({ hasVideo: true, hidden: true }), false);
  assert.equal(showCallPane({ hasVideo: false }), false);
});

test("layout: coach only without a call, side by side when wide, stacked when narrow", () => {
  assert.equal(stageLayout({ width: 1600, withCall: false }), "coach-only");
  assert.equal(stageLayout({ width: 1600, withCall: true }), "side-by-side");
  assert.equal(stageLayout({ width: STACK_BELOW_PX - 1, withCall: true }), "stacked");
  assert.equal(stageLayout({ width: STACK_BELOW_PX, withCall: true }), "side-by-side");
});
