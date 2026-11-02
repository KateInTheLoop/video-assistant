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

test("resume walkthrough shows every role immediately and navigation survives the LLM response", async () => {
  const result = deferred();
  const cvText = "PROFESSIONAL EXPERIENCE\n" + Array.from({ length: 7 }, (_, n) => 6 - n)
    .map(i => `Engineer ${i} January ${2000 + i} - December ${2000 + i}\nExample Employer ${i}\n- Maintained system ${i}`).join("\n") + "\nEDUCATION\nExample College";
  const h = await panelHarness({ getHint: () => result.promise,
    loadSettings: async () => ({ cvText, stories: [], deepgramKey: "example", sttProvider: "deepgram", model: "example" }),
  });
  await h.$("btnMic").onclick();
  h.connections[0].opts.onFinal({ speaker: "interviewer", text: "Can you walk me through your resume?", speechFinal: true });
  const response = h.run("requestHint()");
  assert.equal(h.$("careerWalkthrough").hidden, false);
  assert.equal(h.$("careerRoles").children.length, 7);
  assert.equal(h.$("careerRole").children[0].textContent, "Engineer 0");
  h.$("careerRoles").children[2].onclick();
  assert.equal(h.$("careerProgress").textContent, "Role 3 of 7");
  result.resolve({ hint: { is_question: true, question_type: "experience", question_summary: "Career summary", stories: [{ title: "Only one story", cue: "Narrow selection" }], keywords: [],
    career_overview: ["Engineering roles across seven organizations", "Repeated experience maintaining systems"] }, usage: {}, ms: 1 });
  await response;
  assert.equal(h.$("careerProgress").textContent, "Role 3 of 7");
  assert.equal(h.$("careerOverview").children.length, 2);
  assert.equal(h.$("stories").hidden, true);
  assert.equal(h.$("gapNotice").hidden, true);
  assert.equal(h.run("gapQuestions().length"), 0);
  h.$("careerSlider").value = "6"; h.$("careerSlider").oninput();
  assert.equal(h.$("careerRole").children[0].textContent, "Engineer 6");
  assert.equal(h.$("careerNext").disabled, true);
  h.$("careerOrder").value = "newest"; h.$("careerOrder").onchange();
  assert.equal(h.$("careerProgress").textContent, "Role 1 of 7");
  assert.equal(h.$("careerRole").children[0].textContent, "Engineer 6");
  h.$("careerNext").onclick();
  assert.equal(h.$("careerRole").children[0].textContent, "Engineer 5");
  h.$("careerPrev").onclick();
  assert.equal(h.$("careerRole").children[0].textContent, "Engineer 6");
});

test("unrecognized CV layout preserves the whole source instead of silently dropping jobs", async () => {
  const h = await panelHarness({ loadSettings: async () => ({ cvText: "Undated role at Example Co", stories: [], deepgramKey: "example" }) });
  h.run('renderHint({ question_type: "career_walkthrough", question_summary: "Career", stories: [], keywords: [] })');
  assert.match(h.$("careerSummary").textContent, /could not be separated/);
  assert.equal(h.$("careerRole").children[0].textContent, "Undated role at Example Co");
  assert.equal(h.$("gapNotice").hidden, true);
});

test("interim captions update one live node while keeping history and pending hints independent", async () => {
  const result = deferred();
  const h = await panelHarness({ getHint: () => result.promise });
  await h.$("btnMic").onclick();
  const events = h.connections[0].opts;
  events.onFinal({ speaker: "interviewer", text: "A question?", speechFinal: true });
  const history = h.$("transcript").children[0];
  const pending = h.run("requestHint()");
  events.onInterim({ speaker: "candidate", text: "First words", backlogMs: 250 });
  const live = h.$("transcript").children.at(-1);
  assert.equal(live.lastChild.nodeValue || live.lastChild.textContent, "First words");
  events.onInterim({ speaker: "candidate", text: "First words keep flowing", backlogMs: 150 });
  assert.equal(h.$("transcript").children[0], history);
  assert.equal(h.$("transcript").children.at(-1), live);
  assert.equal(live.lastChild.nodeValue, "First words keep flowing");
  assert.match(live.children[0].textContent, /live/);
  assert.equal(h.run("captionSamples.length"), 2);
  result.resolve({ hint: { is_question: false, question_type: "none", question_summary: "", stories: [], keywords: [] }, usage: {}, ms: 1 });
  await pending;
});

test("topic experience filters the timeline, connects a story and preserves selection as semantic evidence arrives", async () => {
  const result = deferred();
  const cvText = "PROFESSIONAL EXPERIENCE\nRecent Analyst January 2022 - December 2022\nExample Recent\n- Used SQL for reports\nUnrelated January 2021 - December 2021\nExample Other\n- Managed office supplies\nEarlier Analyst January 2020 - December 2020\nExample Earlier\n- SQL reporting checks\nRelated Engineer January 2019 - December 2019\nExample Platform\n- Validated warehouse data pipelines\nEDUCATION\nExample College";
  const stories = [{ title: "Reporting checks", situation: "A report needed checking", action: "Supported reporting validation", result: "Checks completed", tags: "SQL" },
    { title: "Unrelated vendor meeting", situation: "A supplier meeting", action: "Scheduled appointments", result: "Meeting held" }];
  const h = await panelHarness({ getHint: () => result.promise, loadSettings: async () => ({ cvText, stories, deepgramKey: "example", contextTier: "full" }) });
  await h.$("btnMic").onclick();
  h.connections[0].opts.onFinal({ speaker: "interviewer", text: "Tell me about your experience with SQL", speechFinal: true });
  const response = h.run("requestHint()");
  assert.equal(h.$("careerTitle").textContent, "Experience with SQL");
  assert.equal(h.$("careerRoles").children.length, 2);
  assert.equal(h.$("careerRole").children[0].textContent, "Earlier Analyst");
  h.$("careerNext").onclick();
  result.resolve({ hint: { is_question: true, question_type: "experience", question_summary: "SQL experience", stories: [], keywords: [],
    experience_outline: ["Early reporting checks", "Later reporting work", "Connect validation skills to this role"],
    experience_evidence: [{ role: 1, quote: "Validated warehouse data pipelines", story: "Reporting checks" }, { role: 2, quote: "SQL reporting checks", story: "Reporting checks" }, { role: 3, quote: "Invented SQL ownership", story: null },
      { role: 999, quote: "Invented citation", story: "Unrelated vendor meeting" }] }, usage: {}, ms: 1 });
  await response;
  assert.equal(h.$("careerRoles").children.length, 3);
  assert.equal(h.$("careerRole").children[0].textContent, "Recent Analyst", "selection follows the role, not a shifted index");
  assert.equal(h.$("careerOverview").children.length, 3);
  assert.equal(h.$("experienceExamples").hidden, false);
  assert.equal(h.$("experienceStories").children.length, 1, "an invalid citation must not promote an unrelated story");
  assert.equal(h.$("gapNotice").hidden, true);
  h.$("careerRoles").children[1].onclick();
  assert.ok(h.$("careerRole").children.some(node => node.children?.[0]?.textContent?.startsWith("Prepared story: Reporting checks")));
  const confirmation = h.$("experienceStories").children[0].children.find(node => node.textContent === "Used this story");
  assert.ok(confirmation, "topic examples retain the story-use confirmation control");
  confirmation.onclick();
  assert.equal(h.run('questions[0].usedStories[0]'), "Reporting checks");
  h.$("experienceStories").children[0].children.find(node => node.textContent === "Used ✓ — undo").onclick();
  assert.equal(h.run("questions[0].usedStories.length"), 0);
  assert.equal(h.run("questions[0].hint.experience_topic"), "SQL");
});

test("years questions show role-window caveats and undated followups remain unknown", async () => {
  const cvText = "PROFESSIONAL EXPERIENCE\nAnalyst January 2020 - December 2021\nExample A\n- SQL reporting\nEngineer July 2021 - June 2022\nExample B\n- Used SQL for validation\nSKILLS\nWorkday";
  const h = await panelHarness({ loadSettings: async () => ({ cvText, stories: [], deepgramKey: "example" }),
    getHint: async () => ({ hint: { is_question: true, question_type: "experience", question_summary: "Experience", stories: [], keywords: [] }, usage: {}, ms: 1 }),
  });
  await h.$("btnMic").onclick();
  h.connections[0].opts.onFinal({ speaker: "interviewer", text: "How many years of experience do you have with SQL?", speechFinal: true });
  await h.run("requestHint()");
  assert.match(h.$("experienceDuration").children[0].textContent, /Up to 2 years 6 months/);
  assert.match(h.$("experienceDuration").children[1].textContent, /do not confirm continuous use/);
  h.run('scheduler.lastFiredAt = -Infinity; scheduler.pending = "And with Workday?"');
  await h.run("requestHint()");
  assert.equal(h.run("questions.length"), 2, "a new topic cannot replace the previous topic");
  assert.equal(h.$("careerTitle").textContent, "Experience with Workday");
  assert.match(h.$("experienceDuration").children[0].textContent, /not established/);
  assert.match(h.$("careerRole").children[0].textContent, /CV mentions \(dates not established\):\nWorkday/);
  assert.equal(h.run("gapQuestions().length"), 0);
});
