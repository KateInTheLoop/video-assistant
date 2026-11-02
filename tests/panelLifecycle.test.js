import { test } from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { browserHarness, deferred } from "./browserHarness.js";

function mediaStream() {
  const track = { stopped: false, stop() { this.stopped = true; } };
  return { getAudioTracks: () => [track], getTracks: () => [track], getVideoTracks: () => [] };
}

async function panelHarness(overrides = {}) {
  const connections = [], captures = [], sessions = [], updates = [];
  class Stt {
    constructor(opts) { this.opts = opts; connections.push(this); }
    async start(stream) { this.stream = stream; }
    stop() { this.stopped = true; }
  }
  const h = await browserHarness("panel.js", {
    crypto: webcrypto,
    loadSettings: async () => ({ sttProvider: "deepgram", deepgramKey: "test", stories: [], model: "claude-haiku-5-5" }),
    SttStream: Stt,
    navigator: { mediaDevices: { getUserMedia: async () => { const s = mediaStream(); captures.push(s); return s; } } },
    chrome: { storage: { onChanged: { addListener() {} }, local: { get: async () => ({}), set: async () => {} } } },
    appendTranscript: async s => { sessions.push(s); },
    updateSession: async s => { updates.push(s); },
    debrief: async () => ({ overall: "Complete" }),
    ...overrides,
  });
  return { ...h, connections, captures, sessions, updates };
}

test("repeated mic capture creates one connection and Stop closes all owned audio", async () => {
  const h = await panelHarness();
  await Promise.all([h.$("btnMic").onclick(), h.$("btnMic").onclick()]);
  await h.$("btnMic").onclick();
  assert.equal(h.connections.length, 1);
  assert.equal(h.captures.length, 1);
  await h.$("btnStop").onclick();
  assert.equal(h.connections[0].stopped, true);
  assert.equal(h.captures[0].getTracks()[0].stopped, true);
});

test("Stop while permission is pending disposes a late stream without starting STT", async () => {
  const permission = deferred();
  const h = await panelHarness({ navigator: { mediaDevices: { getUserMedia: () => permission.promise } } });
  const capture = h.$("btnMic").onclick();
  await h.$("btnStop").onclick();
  const stream = mediaStream(); permission.resolve(stream);
  await capture;
  assert.equal(stream.getTracks()[0].stopped, true);
  assert.equal(h.connections.length, 0);
  assert.equal(h.run("sessionStart"), null);
});

test("failed STT setup releases the microphone and allows retry", async () => {
  class FailingStt { async start() { throw new Error("Simulated connection failure"); } stop() { this.stopped = true; } }
  const h = await panelHarness({ SttStream: FailingStt });
  await h.$("btnMic").onclick();
  assert.equal(h.captures[0].getTracks()[0].stopped, true);
  assert.equal(h.$("btnMic").disabled, false);
  assert.equal(h.$("btnStop").disabled, true);
  await h.$("btnMic").onclick();
  assert.equal(h.captures.length, 2);
});

test("a late hint and speech callbacks cannot enter a new session", async () => {
  const response = deferred(); let callbacks;
  const h = await panelHarness({ getHint: opts => { callbacks = opts; return response.promise; } });
  await h.$("btnMic").onclick();
  const oldConnection = h.connections[0];
  h.run('scheduler.pending = "What is your experience?"');
  const hint = h.run("requestHint()");
  await h.$("btnStop").onclick();
  assert.equal(h.timers.size, 0);
  await h.$("btnMic").onclick();
  oldConnection.opts.onFinal({ speaker: "interviewer", text: "Old question", speechFinal: true });
  callbacks.onPartial({ is_question: true, question_summary: "Old question" });
  response.resolve({ hint: { is_question: true, question_summary: "Old question", stories: [], keywords: [] }, usage: {}, ms: 1 });
  await hint;
  assert.equal(h.run("questions.length"), 0);
  assert.equal(h.run("transcript.length"), 0);
  assert.equal(h.run("scheduler.inFlight"), false);
});

test("a previous debrief cannot reset or overwrite a running session", async () => {
  const result = deferred();
  const h = await panelHarness({ debrief: () => result.promise });
  await h.$("btnMic").onclick();
  h.run('transcript = [{ speaker: "interviewer", text: "Question A", t: Date.now() }]');
  const stop = h.$("btnStop").onclick();
  await h.$("btnMic").onclick();
  const activeStart = h.run("sessionStart");
  h.$("status").textContent = "New session live";
  result.resolve({ overall: "Debrief A" });
  await stop;
  assert.equal(h.run("sessionStart"), activeStart);
  assert.notEqual(activeStart, null);
  assert.equal(h.$("status").textContent, "New session live");
  assert.equal(h.updates[0].id, h.sessions[0].id);
  assert.equal(h.updates[0].lines[0].text, "Question A");
});
