import { test } from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { browserHarness, deferred } from "./browserHarness.js";

const result = text => ({ hint: { is_question: true, follow_up: false, question_type: "technical", question_summary: text, technical_points: ["A queue buffers work."], stories: [], keywords: [] }, usage: {}, ms: 1 });
async function flush() { for (let i = 0; i < 12; i++) await Promise.resolve(); }
async function coach(overrides = {}) {
  const calls = [], connections = [], storage = new Map();
  class Speech { constructor(options) { this.options = options; connections.push(this); } async start() {} stop() { this.stopped = true; } }
  const h = await browserHarness("panel.js", {
    crypto: webcrypto,
    loadSettings: async () => ({ sttProvider: "deepgram", deepgramKey: "example", stories: [], resources: [], model: "example" }),
    SttStream: Speech,
    localStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) },
    navigator: { mediaDevices: { getDisplayMedia: async () => ({ getAudioTracks: () => [{}], getVideoTracks: () => [], getTracks: () => [{ stop() {} }] }) } },
    chrome: { storage: { onChanged: { addListener() {} }, local: { get: async () => ({}), set: async () => {} } } },
    saveSessionDraft: async () => {}, recoverSessionDrafts: async () => [], appendTranscript: async () => {}, updateSession: async () => {}, debrief: async () => ({}),
    getHint: async options => { calls.push(options); return result(options.question); },
    ...overrides,
  });
  await h.$("btnTab").onclick();
  const final = (text, speaker = "interviewer", speechFinal = true) => connections[0].options.onFinal({ speaker, text, speechFinal });
  const interim = text => connections[0].options.onInterim({ speaker: "interviewer", text });
  const manual = () => { h.$("questionMode").value = "manual"; h.$("questionMode").onchange(); };
  return { ...h, calls, connections, storage, final, interim, manual };
}

test("Manual keeps noisy captions without scheduling hints, then captures immediately on demand", async () => {
  const response = deferred(), calls = [];
  const h = await coach({ getHint: options => { calls.push(options); return response.promise; } });
  h.manual(); h.final("Background speech that is not a useful interview question");
  h.connections[0].options.onUtteranceEnd({ speaker: "interviewer" });
  assert.equal(h.run("scheduler.pending"), "");
  assert.equal(calls.length, 0); assert.equal(h.run("questions.length"), 0);
  assert.equal(h.$("transcript").children.length, 1);
  h.final("Explain notification retries?");
  const question = h.$("btnCaptureQuestion").onclick();
  assert.equal(calls[0].question, "Explain notification retries?");
  assert.equal(calls[0].questionSource, "manual");
  assert.equal(h.run("questions.length"), 1);
  assert.equal(h.$("hintActions").hidden, false);
  assert.equal(question.analysis, "loading");
  assert.match(h.$("questions").children[0].className, /status-new/);
  response.resolve(result("Notification retries")); await flush();
  assert.equal(question.analysis, "ready");
  assert.equal(h.$("question").textContent, "Explain notification retries?");
});

test("capturing interim words and their final does not duplicate the explicit question in Auto", async () => {
  const h = await coach();
  h.interim("What is a queue"); h.$("btnCaptureQuestion").onclick(); await flush();
  h.final("What is a queue?", "interviewer", false);
  h.connections[0].options.onUtteranceEnd({ speaker: "interviewer" });
  h.$("btnCaptureQuestion").onclick(); await flush();
  assert.equal(h.calls.length, 1); assert.equal(h.run("questions.length"), 1);
  assert.equal(h.run("scheduler.pending"), "");
});

test("explicitly recapturing a fuller question refreshes the same card and ignores its old response", async () => {
  const first = deferred(), calls = [];
  const h = await coach({ getHint: options => { calls.push(options); return calls.length === 1 ? first.promise : Promise.resolve(result(options.question)); } });
  h.manual(); h.interim("Explain retries"); const question = h.$("btnCaptureQuestion").onclick();
  h.final("Explain retries when the provider has no idempotency support?");
  h.$("btnCaptureQuestion").onclick();
  assert.equal(h.run("questions.length"), 1); assert.equal(calls.length, 1);
  first.resolve(result("Old incomplete question")); await flush(); await h.run("requestHint()");
  assert.equal(calls.length, 2);
  assert.equal(calls[1].question, "Explain retries when the provider has no idempotency support?");
  assert.equal(question.analysis, "ready");
  assert.equal(h.$("question").textContent, calls[1].question);
});

test("refreshing a completed capture clears old coaching until the new answer arrives", async () => {
  const refresh = deferred(); let calls = 0;
  const h = await coach({ getHint: options => ++calls === 1 ? Promise.resolve(result(options.question)) : refresh.promise });
  h.manual(); h.interim("Explain queue retries"); h.$("btnCaptureQuestion").onclick(); await flush();
  assert.equal(h.$("technicalNotes").hidden, false);
  h.final("Explain queue retries when the provider cannot deduplicate sends?"); h.$("btnCaptureQuestion").onclick();
  assert.equal(h.run("questions.length"), 1); assert.equal(h.$("technicalNotes").hidden, true);
  refresh.resolve(result("Retries without provider deduplication")); await flush();
  assert.equal(h.$("technicalNotes").hidden, false);
});

test("clicking an older transcript line sends that question instead of newer speech", async () => {
  const h = await coach(); h.manual();
  h.final("Explain the original queue question?"); h.final("My response", "candidate"); h.final("A newer database question?");
  h.$("transcript").children[0].onclick(); await flush();
  assert.equal(h.calls[0].question, "Explain the original queue question?");
  assert.equal(h.calls[0].questionSource, "transcript");
  assert.equal(h.$("question").textContent, "Explain the original queue question?");
});

test("selected transcript text takes precedence and Space leaves typing and controls alone", async () => {
  const h = await coach(); h.manual(); h.final("Some context and a question about retry budgets");
  h.$("transcript").contains = () => true;
  h.context.window.getSelection = () => ({ anchorNode: {}, focusNode: {}, toString: () => "question about retry budgets" });
  h.$("btnCaptureQuestion").onclick(); await flush();
  assert.equal(h.calls[0].question, "question about retry budgets");
  h.context.window.getSelection = () => null;
  h.final("A different question about ownership?");
  function space(extra = {}) { h.context.document.dispatchEvent({ type: "keydown", key: " ", code: "Space", target: { tagName: "DIV" }, preventDefault() {}, ...extra }); }
  space({ target: { tagName: "TEXTAREA" } }); space({ target: { isContentEditable: true } }); space({ target: { tagName: "SELECT" } }); space({ repeat: true }); space({ ctrlKey: true });
  assert.equal(h.calls.length, 1);
  space(); await flush(); assert.equal(h.calls.length, 2);
  assert.equal(h.calls[1].question, "A different question about ownership?");
});

test("Automatic preserves Space scrolling while retaining the explicit capture button", async () => {
  const h = await coach(); h.final("A question that can be detected automatically?");
  let prevented = false;
  h.context.document.dispatchEvent({ type: "keydown", key: " ", code: "Space", target: { tagName: "DIV" }, preventDefault() { prevented = true; } });
  assert.equal(prevented, false); assert.equal(h.calls.length, 0); assert.equal(h.run("questions.length"), 0);
  h.$("btnCaptureQuestion").onclick(); await flush();
  assert.equal(h.calls.length, 1); assert.equal(h.run("questions.length"), 1);
});

test("switching to Manual suppresses old automatic partials and results, then drains explicit work", async () => {
  const automatic = deferred(), calls = [];
  const h = await coach({ getHint: options => { calls.push(options); return calls.length === 1 ? automatic.promise : Promise.resolve(result(options.question)); } });
  h.final("An automatically detected old question?");
  const old = h.run("requestHint()");
  h.manual(); h.final("The manually selected new question?"); h.$("btnCaptureQuestion").onclick();
  assert.equal(calls.length, 1, "the explicit request waits for the existing connection");
  calls[0].onPartial(result("Stale automatic question").hint);
  assert.equal(h.run("partialFrame"), 0);
  automatic.resolve(result("Stale automatic question")); await old;
  await h.run("requestHint()");
  assert.equal(calls.length, 2); assert.equal(h.run("questions.length"), 1);
  assert.equal(h.$("question").textContent, "The manually selected new question?");
});

test("postponing and skipping queued captures avoids requests until Answer now resumes one", async () => {
  const first = deferred(), calls = [];
  const h = await coach({ getHint: options => { calls.push(options); return calls.length === 1 ? first.promise : Promise.resolve(result(options.question)); } });
  h.manual(); h.final("First question?"); h.$("btnCaptureQuestion").onclick();
  h.final("Postponed question?"); const later = h.$("btnCaptureQuestion").onclick();
  h.run(`setQuestionStatus(questions.find(q => q.id === ${later.id}), "later")`);
  h.final("Skipped question?"); const skipped = h.$("btnCaptureQuestion").onclick();
  h.run(`setQuestionStatus(questions.find(q => q.id === ${skipped.id}), "dismissed")`);
  first.resolve(result("First question")); await flush(); await h.run("requestHint()");
  assert.equal(calls.length, 1); assert.equal(later.analysis, "idle"); assert.equal(skipped.analysis, "idle");
  h.run(`setQuestionStatus(questions.find(q => q.id === ${later.id}), "answering")`); await flush();
  assert.equal(calls.length, 2); assert.equal(calls[1].question, "Postponed question?");
  assert.equal(later.status, "answering"); assert.equal(skipped.status, "dismissed");
});

test("background coaching cannot replace a reviewed card or resurrect a skipped card", async () => {
  const pending = deferred(), calls = [];
  const h = await coach({ getHint: options => { calls.push(options); return calls.length === 1 ? Promise.resolve(result(options.question)) : pending.promise; } });
  h.manual(); h.final("First captured question?"); const first = h.$("btnCaptureQuestion").onclick(); await flush();
  h.final("Second captured question?"); const second = h.$("btnCaptureQuestion").onclick();
  h.run(`selectQuestion(questions.find(q => q.id === ${first.id}))`);
  calls[1].onPartial(result("Partial second question").hint);
  assert.equal(h.run("partialFrame"), 0);
  h.run(`setQuestionStatus(questions.find(q => q.id === ${second.id}), "dismissed")`);
  pending.resolve(result("Second question")); await flush();
  assert.equal(h.run("selectedId"), first.id);
  assert.equal(h.$("question").textContent, "First captured question?");
  assert.equal(second.status, "dismissed"); assert.equal(second.analysis, "ready");
});

test("failed manual coaching keeps its card and Answer now retries without duplicating it", async () => {
  let attempts = 0;
  const h = await coach({ getHint: async options => { if (++attempts === 1) throw new Error("Example network failure"); return result(options.question); } });
  h.manual(); h.final("Please explain retries?"); const q = h.$("btnCaptureQuestion").onclick(); await flush();
  assert.equal(q.analysis, "error"); assert.equal(h.run("gapQuestions().length"), 0);
  h.run(`setQuestionStatus(questions[0], "answering")`); await flush();
  assert.equal(q.analysis, "ready"); assert.equal(attempts, 2); assert.equal(h.run("questions.length"), 1);
});

test("a model non-question response cannot erase an explicit capture or invent a story gap", async () => {
  const h = await coach({ getHint: async () => ({ hint: { is_question: false, question_type: "none", question_summary: "", stories: [], keywords: [] }, usage: {}, ms: 1 }) });
  h.manual(); h.final("SQL?"); const q = h.$("btnCaptureQuestion").onclick(); await flush();
  assert.equal(h.run("questions.length"), 1); assert.equal(q.rawText, "SQL?");
  assert.equal(q.analysis, "error"); assert.equal(h.run("gapQuestions().length"), 0);
  assert.equal(h.$("question").textContent, "SQL?");
  assert.equal(h.$("hintActions").hidden, false);
});

test("Stop invalidates manual hints and clears pending work before a new interview", async () => {
  const pending = deferred();
  const h = await coach({ getHint: () => pending.promise });
  h.manual(); h.final("Old captured question?"); const q = h.$("btnCaptureQuestion").onclick();
  await h.$("btnStop").onclick();
  assert.equal(q.analysis, "idle"); assert.equal(h.$("btnCaptureQuestion").disabled, true);
  assert.match(h.$("hintState").textContent, /Capture stopped/);
  await h.$("btnTab").onclick();
  pending.resolve(result("Old late hint")); await flush();
  assert.equal(h.run("questions.length"), 0); assert.equal(h.run("manualRequests.length"), 0);
  assert.equal(h.$("questionMode").value, "manual");
});

test("mode choice persists locally and blocked storage does not disable manual capture", async () => {
  const stored = new Map();
  const localStorage = { getItem: key => stored.get(key), setItem: (key, value) => stored.set(key, value) };
  const first = await coach({ localStorage }); first.manual();
  const next = await coach({ localStorage });
  assert.equal(next.$("questionMode").value, "manual");
  next.final("Only captured questions should be coached?"); assert.equal(next.calls.length, 0);
  const blocked = await coach({ localStorage: { getItem() { throw new Error("Blocked"); }, setItem() { throw new Error("Blocked"); } } });
  blocked.manual(); blocked.final("Capture despite blocked storage?"); blocked.$("btnCaptureQuestion").onclick(); await flush();
  assert.equal(blocked.calls.length, 1); assert.match(blocked.$("questionCaptureNotice").textContent, /saving is unavailable/);
});
