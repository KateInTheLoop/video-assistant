import { test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { parseTime, formatTime, loopRange, seekTarget, loopRestart } from "../dev/replay/playback.js";
import { createReplayServer } from "../scripts/replay.mjs";

test("replay loop timestamps accept seconds, minutes and hours with millisecond precision", () => {
  assert.equal(parseTime(" 90.25 "), 90.25);
  assert.equal(parseTime("1:30.25"), 90.25);
  assert.equal(parseTime("1:02:03.125"), 3723.125);
  for (const time of [0, 9.125, 65.9, 3599.999, 3723.125]) {
    const result = parseTime(formatTime(time));
    assert.ok(result <= time && time - result < 0.0011);
  }
});

test("replay rejects ambiguous, negative and malformed timestamps", () => {
  for (const value of ["", "-1", "1:60", "1:65:02", "1::02", "1:2:3:4", "1e3", "Infinity", "NaN", "1.2:03", "1:23.1234"]) {
    assert.throws(() => parseTime(value));
  }
});

test("loop bounds reject unavailable duration, reversed points and clips outside the file", () => {
  assert.deepEqual(loopRange("0:10.5", "0:20", 30), { start: 10.5, end: 20 });
  for (const duration of [0, NaN, Infinity]) assert.throws(() => loopRange("0", "2", duration), /duration/);
  assert.throws(() => loopRange("2", "1", 30), /after/);
  assert.throws(() => loopRange("2", "2.1", 30), /after/);
  assert.throws(() => loopRange("0", "31", 30), /within/);
  assert.throws(() => loopRange("30", "30", 30), /within/);
});

test("manual jumps stay within the recording or enabled section without immediately wrapping", () => {
  const range = { start: 10, end: 20 };
  assert.equal(seekTarget(-10, 30), 0);
  assert.equal(seekTarget(99, 30), 30);
  assert.equal(seekTarget(0, 30, range), 10);
  assert.ok(seekTarget(99, 30, range) < 20);
  assert.equal(loopRestart(seekTarget(99, 30, range), range), null);
  assert.equal(seekTarget(15, 30, range), 15);
});

test("section loops wrap at the end, after native seeking outside, and at the end of the file", () => {
  const range = { start: 10, end: 20 };
  assert.equal(loopRestart(19.9, range), null);
  assert.equal(loopRestart(20, range), 10);
  assert.equal(loopRestart(30, range, true), 10);
  assert.equal(loopRestart(5, range), 10);
  assert.equal(loopRestart(10, range), null);
  assert.equal(loopRestart(30, null, true), null);
});

async function serve(t) {
  const server = createReplayServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  return `http://127.0.0.1:${server.address().port}`;
}

test("replay server serves the dependency-free player and HEAD responses", async t => {
  const url = await serve(t);
  for (const path of ["/", "/replay.css", "/replay.js", "/playback.js"]) {
    const response = await fetch(url + path);
    assert.equal(response.status, 200, path);
    assert.ok((await response.text()).length > 100);
  }
  const response = await fetch(url, { method: "HEAD" });
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /text\/html/);
  assert.match(response.headers.get("content-security-policy"), /media-src blob:/);
  assert.equal(await response.text(), "");
});

test("replay server cannot expose repository files or accept recording uploads", async t => {
  const url = await serve(t);
  for (const path of ["/.git/config", "/panel.js", "/../README.md", "/%2e%2e/README.md", "/recording.mp4"]) {
    assert.equal((await fetch(url + path)).status, 404, path);
  }
  const response = await fetch(url, { method: "POST", body: "synthetic recording" });
  assert.equal(response.status, 405);
  assert.equal(response.headers.get("allow"), "GET, HEAD");
});
