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
    saveSessionDraft: async () => {}, recoverSessionDrafts: async () => [],
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

test("debit versus credit streams from the LLM into technical notes without a story warning", async () => {
  const originalFetch = globalThis.fetch;
  const technical = { is_question: true, follow_up: false, question_type: "technical", question_summary: "Difference between debit and credit",
    technical_points: ["Debit is the left side; credit is the right side.", "Debits increase assets and expenses; credits increase liabilities, equity and revenue.", "Buying equipment for $100 cash: debit equipment $100; credit cash $100."],
    stories: [], keywords: ["account type"], cv_leads: [], answer_shape: [], follow_ups: [], watch_out: "" };
  let sent;
  globalThis.fetch = async (_url, opts) => {
    sent = JSON.parse(opts.body);
    const events = [{ type: "message_start", message: { usage: {}, model: sent.model } },
      { type: "content_block_delta", delta: { type: "text_delta", text: JSON.stringify(technical) } },
      { type: "message_delta", usage: {}, delta: { stop_reason: "end_turn" } }];
    return new Response(events.map(e => `data: ${JSON.stringify(e)}\n\n`).join(""));
  };
  try {
    const h = await panelHarness({ loadSettings: async () => ({ anthropicKey: "example-test", deepgramKey: "example", sttProvider: "deepgram", model: "example", cvText: "Accounting CV", stories: [] }) });
    await h.$("btnMic").onclick();
    h.connections[0].opts.onFinal({ speaker: "interviewer", text: "What is the difference between debit and credit?", speechFinal: true });
    await h.run("requestHint()");
    assert.match(sent.messages[0].content, /difference between debit and credit/);
    assert.ok(sent.output_config.format.schema.required.includes("technical_points"));
    assert.equal(h.$("technicalNotes").hidden, false);
    assert.equal(h.$("technicalPoints").children.at(-1).textContent, technical.technical_points[2]);
    assert.equal(h.$("gapNotice").hidden, true);
    assert.equal(h.run("gapQuestions().length"), 0);
    assert.equal(h.run("questions[0].hint.technical_points.length"), 3);
    assert.doesNotMatch(h.$("questions").children.at(-1).children[1].textContent, /⚠/);
  } finally { globalThis.fetch = originalFetch; }
});

test("profile changes during an interview apply only to the next interview; diagnostics never reload settings", async () => {
  let changed, reads = 0, sent;
  let current = { candidateName: "Candidate A", cvText: "CV A", jobTitle: "Job A", stories: [], deepgramKey: "example", sttProvider: "deepgram", profiles: { activeCandidate: "c-1", activeJob: "j-1" } };
  const h = await panelHarness({
    loadSettings: async () => { reads++; return structuredClone(current); },
    chrome: { storage: { onChanged: { addListener(fn) { changed = fn; } }, local: { get: async () => ({}), set: async () => {} } } },
    getHint: async opts => { sent = opts; return { hint: { is_question: false, question_summary: "", question_type: "none", stories: [], keywords: [] }, usage: {}, ms: 1 }; },
  });
  await h.$("btnMic").onclick();
  h.connections[0].opts.onFinal({ speaker: "interviewer", text: "Question for A", speechFinal: true });
  current = { ...current, candidateName: "Candidate B", cvText: "CV B", profiles: { activeCandidate: "c-2", activeJob: "j-1" } };
  await changed({ diag: { newValue: [] } }, "local");
  await changed({ sessionDrafts: { newValue: {} } }, "local");
  assert.equal(reads, 1);
  await changed({ profiles: { newValue: {} } }, "local");
  await h.run("requestHint()");
  assert.equal(sent.cvText, "CV A");
  await h.$("btnStop").onclick();
  assert.equal(h.sessions[0].candidateName, "Candidate A");
  assert.equal(h.sessions[0].candidateId, "c-1");
  await h.$("btnMic").onclick();
  assert.equal(h.run("settings.cvText"), "CV B");
});

test("final captions checkpoint the transcript and reopening restores it without an AI call", async () => {
  let draft;
  const first = await panelHarness({ saveSessionDraft: async value => { draft = structuredClone(value); } });
  await first.$("btnMic").onclick();
  first.connections[0].opts.onFinal({ speaker: "candidate", text: "Saved final answer", speechFinal: true });
  assert.equal(draft.lines[0].text, "Saved final answer");
  assert.equal("anthropicKey" in draft, false);
  const reopened = await panelHarness({ recoverSessionDrafts: async () => [{ ...draft, recovered: true }], debrief: async () => { throw new Error("Recovery must stay local"); } });
  assert.equal(reopened.run("transcript[0].text"), "Saved final answer");
  assert.equal(reopened.run("sessionStart"), null);
  assert.match(reopened.$("status").textContent, /Recovered an interrupted interview/);
});
