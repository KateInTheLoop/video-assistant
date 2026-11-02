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

function selectCaption(h, row) {
  const node = row.lastChild;
  h.context.window.getSelection = () => ({ anchorNode: node, focusNode: node, toString: () => node.nodeValue, containsNode: el => el === row });
}

test("a selected older question survives finalized captions and captures the original text", async () => {
  const h = await coach(); h.manual();
  h.final("Explain the original queue question?"); h.final("A response", "candidate");
  const row = h.$("transcript").children[0]; selectCaption(h, row);
  h.final("A newer question about indexes?");
  assert.equal(h.$("transcript").children[0], row);
  assert.equal(row.parentElement, h.$("transcript"));
  h.$("btnCaptureQuestion").onclick(); await flush();
  assert.equal(h.calls[0].question, "Explain the original queue question?");
  assert.equal(h.calls[0].questionSource, "transcript");
});

test("merged updates wait for selection release without losing recorded words", async () => {
  const h = await coach(); h.manual(); h.final("Explain retry queues");
  const row = h.$("transcript").children[0]; selectCaption(h, row);
  h.final("when delivery fails?");
  assert.equal(row.lastChild.nodeValue, "Explain retry queues");
  assert.equal(h.run("transcript[0].text"), "Explain retry queues when delivery fails?");
  h.$("btnCaptureQuestion").onclick(); await flush();
  assert.equal(h.calls[0].question, "Explain retry queues");
  h.context.window.getSelection = () => null;
  h.context.document.dispatchEvent({ type: "selectionchange" });
  assert.equal(row.lastChild.nodeValue, "Explain retry queues when delivery fails?");
  assert.equal(h.$("transcript").children[0], row);
});

test("selected live words survive finalization and do not get reused for another interim", async () => {
  const h = await coach(); h.manual(); h.interim("What is a queue");
  const selected = h.$("transcript").lastChild; selectCaption(h, selected);
  h.final("What is a queue and how does it handle retries?");
  h.interim("And what about delivery guarantees");
  assert.equal(selected.parentElement, h.$("transcript"));
  assert.equal(selected.lastChild.nodeValue, "What is a queue");
  assert.notEqual(h.run("interimNodes.interviewer.el"), selected);
  h.$("btnCaptureQuestion").onclick(); await flush();
  assert.equal(h.calls[0].question, "What is a queue");
  h.context.window.getSelection = () => null;
  h.context.document.dispatchEvent({ type: "selectionchange" });
  assert.equal(selected.parentElement, null);
  assert.equal(h.run("interimNodes.interviewer.text.nodeValue"), "And what about delivery guarantees");
});

test("new captions preserve a reader's scroll position and still follow when at the bottom", async () => {
  const h = await coach(); h.manual();
  const view = h.$("transcript"); view.clientHeight = 400; view.scrollHeight = 2000; view.scrollTop = 100;
  h.interim("Live words while reviewing older text"); assert.equal(view.scrollTop, 100);
  h.final("A finalized question while reviewing older text?"); assert.equal(view.scrollTop, 100);
  view.scrollTop = 1600;
  h.interim("More live words at the end"); assert.equal(view.scrollTop, view.scrollHeight);
});

test("the history limit retains a selected row until the selection is released", async () => {
  const h = await coach(); h.manual(); h.final("An older selected question?");
  const selected = h.$("transcript").children[0]; selectCaption(h, selected);
  for (let i = 0; i < 70; i++) h.final(`Sample caption ${i}`, i % 2 ? "interviewer" : "candidate");
  assert.equal(selected.parentElement, h.$("transcript"));
  h.$("btnCaptureQuestion").onclick(); await flush();
  assert.equal(h.calls[0].question, "An older selected question?");
  h.context.window.getSelection = () => null;
  h.context.document.dispatchEvent({ type: "selectionchange" });
  assert.equal(selected.parentElement, null);
  assert.equal(h.$("transcript").children.length, 60);
});

test("pointer interaction holds the clicked row until its capture consumes the visible text", async () => {
  const h = await coach(); h.manual(); h.final("The visible question?");
  const row = h.$("transcript").children[0];
  h.$("transcript").onpointerdown({ button: 0, pointerId: 7, target: { closest: () => row } });
  h.final("A later addition to that utterance?");
  assert.equal(row.dataset.captureText, "The visible question?");
  h.context.document.dispatchEvent({ type: "pointerup", pointerId: 7 });
  row.onclick(); await flush();
  assert.equal(h.calls[0].question, "The visible question?");
  const frame = h.run("transcriptRefreshFrame"), render = h.timers.get(frame);
  h.timers.delete(frame); render();
  assert.equal(row.dataset.captureText, "The visible question? A later addition to that utterance?");
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

test("queued automatic question identity cannot overwrite a postponed card when newer words arrive", async () => {
  let now = 1_000_000; class Clock extends Date { static now() { return now; } }
  const first = deferred(), second = deferred(), calls = [];
  const h = await coach({ Date: Clock, getHint: options => {
    calls.push(options);
    return calls.length === 1 ? first.promise : calls.length === 2 ? second.promise : Promise.resolve(result(options.question));
  } });
  h.final("Initial question A?"); const initial = h.run("requestHint()");
  now += 100; h.final("Queued question B?");
  now += 100; h.interim("Current question C");
  now += 3000; first.resolve(result("Question A")); await initial;
  const queued = h.run("requestHint()");
  const followup = result("Question B"); followup.hint.follow_up = true;
  second.resolve(followup); await queued;
  h.run('setQuestionStatus(questions[1], "later")');
  const postponed = h.run("questions[1]");
  assert.equal(postponed.captureKey, "turn:2");
  const captured = h.$("btnCaptureQuestion").onclick(); await flush();
  assert.equal(h.run("questions.length"), 3);
  assert.equal(postponed.rawText, "Queued question B?"); assert.equal(postponed.status, "later");
  assert.notEqual(captured.id, postponed.id); assert.equal(captured.captureKey, "turn:3");
});

test("an automatic response preserves both the selected card and its displayed coaching", async () => {
  let now = 1_000_000; class Clock extends Date { static now() { return now; } }
  const second = deferred(); let calls = 0;
  const h = await coach({ Date: Clock, getHint: () => ++calls === 1 ? Promise.resolve(result("Question A")) : second.promise });
  h.final("Explain retries?"); await h.run("requestHint()");
  now += 3000; h.final("Explain indexes?"); const request = h.run("requestHint()");
  h.run("selectQuestion(questions[0])"); second.resolve(result("Question B")); await request;
  assert.equal(h.run("questions.length"), 2); assert.equal(h.run("selectedId"), h.run("questions[0].id"));
  assert.equal(h.run("questions[0].hint.question_summary"), "Question A");
  assert.equal(h.$("question").textContent, "Question A");
  assert.equal(h.run("questions[1].hint.question_summary"), "Question B");
});

test("keyboard review keeps focus on its replacement control and preserves queue scrolling", async () => {
  const h = await coach(); h.manual(); h.final("The reviewed question?"); h.$("btnCaptureQuestion").onclick(); await flush();
  const original = h.$("questions").children[0].children[1];
  h.$("questions").scrollTop = 90; original.focus();
  original.onkeydown({ key: "Enter", preventDefault() {}, stopPropagation() {} });
  const replacement = h.$("questions").children[0].children[1];
  assert.notEqual(original, replacement); assert.equal(h.context.document.activeElement, replacement);
  assert.equal(h.$("questions").scrollTop, 90);
  replacement.onkeydown({ key: " ", preventDefault() {}, stopPropagation() {} });
  assert.equal(h.run("questions.length"), 1); assert.equal(h.calls.length, 1);
});

test("queue updates retain a focused action and fall back to review when that action is disabled", async () => {
  const h = await coach(); h.manual(); h.final("The selected question?"); const q = h.$("btnCaptureQuestion").onclick(); await flush();
  const actions = () => h.$("questions").children.find(row => row.dataset.questionId === String(q.id)).lastChild.children;
  actions().find(button => button.dataset.action === "later").focus();
  h.run("renderQueue()");
  assert.equal(h.context.document.activeElement, actions().find(button => button.dataset.action === "later"));
  h.context.document.activeElement.onclick({ stopPropagation() {} });
  const review = h.$("questions").children.find(row => row.dataset.questionId === String(q.id)).children[1];
  assert.equal(h.context.document.activeElement, review); assert.equal(q.status, "later");
});

test("explicit captures reveal their card while background redraws preserve outside focus", async () => {
  const h = await coach(); h.manual();
  const create = h.context.document.createElement, revealed = [];
  h.context.document.createElement = tag => { const node = create(tag); node.scrollIntoView = () => revealed.push(node); return node; };
  h.final("A newly captured question?"); const q = h.$("btnCaptureQuestion").onclick(); await flush();
  assert.ok(revealed.some(node => node.id === `question-text-${q.id}`));
  const count = revealed.length;
  h.$("questionMode").focus(); h.run("renderQueue()");
  assert.equal(h.context.document.activeElement, h.$("questionMode"));
  assert.equal(revealed.length, count);
});

test("an answering question has a separate Retry action after failure and can still be marked done", async () => {
  const first = deferred(); let attempts = 0;
  const h = await coach({ getHint: options => ++attempts === 1 ? first.promise : Promise.resolve(result(options.question)) });
  h.manual(); h.final("Explain retry safety?"); const q = h.$("btnCaptureQuestion").onclick();
  h.run('setQuestionStatus(questions[0], "answering")');
  first.reject(new Error("Sample request failure")); await flush();
  let actions = h.$("questions").children[0].lastChild.children;
  assert.equal(actions[0].textContent, "Done");
  const retry = actions.find(button => button.dataset.action === "retry");
  assert.equal(retry.textContent, "Retry coaching"); assert.match(h.$("hintState").textContent, /Retry coaching/);
  retry.onclick({ stopPropagation() {} }); await flush();
  assert.equal(attempts, 2); assert.equal(q.status, "answering"); assert.equal(q.analysis, "ready");
  assert.equal(h.run("questions.length"), 1);
  actions = h.$("questions").children[0].lastChild.children;
  assert.equal(actions.some(button => button.dataset.action === "retry"), false);
  actions[0].onclick({ stopPropagation() {} });
  assert.equal(q.status, "answered"); assert.equal(attempts, 2);
});

test("the main Retry action preserves answer status and hands keyboard focus to a visible action", async () => {
  const first = deferred(); let attempts = 0;
  const h = await coach({ getHint: options => ++attempts === 1 ? first.promise : Promise.resolve(result(options.question)) });
  const buttons = ["answering", "later", "dismissed", "retry"].map(act => {
    const button = h.context.document.createElement("button"); button.dataset.act = act; h.$("hintActions").appendChild(button); return button;
  });
  h.$("hintActions").querySelectorAll = () => buttons;
  h.$("hintActions").querySelector = selector => buttons.find(button => selector === `[data-act="${button.dataset.act}"]`);
  h.manual(); h.final("Explain retries?"); const q = h.$("btnCaptureQuestion").onclick();
  h.$("hintActions").onclick({ target: buttons[0] });
  first.reject(new Error("Sample failure")); await flush();
  assert.equal(buttons[3].hidden, false); buttons[3].focus();
  h.$("hintActions").onclick({ target: buttons[3] }); await flush();
  assert.equal(attempts, 2); assert.equal(q.status, "answering"); assert.equal(q.analysis, "ready");
  assert.equal(buttons[3].hidden, true); assert.equal(h.context.document.activeElement, buttons[0]);
});

test("Done remains available after a coaching failure without forcing a retry", async () => {
  const pending = deferred(); let attempts = 0;
  const h = await coach({ getHint: () => { attempts++; return pending.promise; } });
  h.manual(); h.final("A question answered from memory?"); const q = h.$("btnCaptureQuestion").onclick();
  h.run('setQuestionStatus(questions[0], "answering")');
  pending.reject(new Error("Sample failure")); await flush();
  const done = h.$("questions").children[0].lastChild.children.find(button => button.dataset.action === "answering");
  assert.equal(done.textContent, "Done"); done.onclick({ stopPropagation() {} });
  assert.equal(q.status, "answered"); assert.equal(attempts, 1);
});
