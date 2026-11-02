import { loadSettings, appendTranscript, updateSession, saveSessionDraft, recoverSessionDrafts } from "./storage.js";
import { SttStream } from "./stt.js";
import { AssemblyAiStream } from "./stt-assemblyai.js";
import { WebSpeechStream } from "./webspeech.js";
import { getHint, prewarmHint, debrief } from "./claude.js";
import { mergeFinal } from "./lib/transcript.js";
import { HintScheduler } from "./lib/scheduler.js";
import { validateHint } from "./lib/hintSchema.js";
import { makeEntry, pushEntry } from "./lib/diag.js";
import { answerStats, paceSummary } from "./lib/pace.js";
import { shouldSupersede, queueOrder, settleAnswering, LIVE } from "./lib/questionQueue.js";
import { createTrace, formatTrace } from "./lib/trace.js";
import { callTracks } from "./lib/callView.js";
import { createPanelLayout } from "./lib/panelLayout.js";
import { provisionalHint, hasStoryGap } from "./lib/hintSchema.js";
import { careerTimeline, isCareerWalkthrough } from "./lib/careerTimeline.js";
import { experienceIntent, routeQuestionHint } from "./lib/experienceContext.js";
import { topicTimeline, topicMatches, experienceDuration, quoteFromRole } from "./lib/experienceTimeline.js";
import { tierIncludes, materialOwner } from "./lib/context.js";
import { preparedResume } from "./lib/preparedResume.js";
import { captionSummary } from "./lib/sttLatency.js";

const $ = (id) => document.getElementById(id);
const ui = {
  tab: $("btnTab"), mic: $("btnMic"), stop: $("btnStop"), status: $("status"),
  call: $("btnCall"), full: $("btnFull"), stage: $("stage"), callPane: $("callPane"), callVideo: $("callVideo"),
  hint: $("hint"), qtype: $("qtype"), question: $("question"), stories: $("stories"),
  keywords: $("keywords"), watch: $("watch"), transcript: $("transcript"),
  talk: $("talk"), paceWarn: $("paceWarn"),
  hintState: $("hintState"), cvLeads: $("cvLeads"), hintActions: $("hintActions"), questions: $("questions"), save: $("btnSave"),
  bankWarn: $("bankWarn"), gapNotice: $("gapNotice"),
  shapeBox: $("shapeBox"), answerShape: $("answerShape"), followUps: $("followUps"),
  technicalNotes: $("technicalNotes"), technicalPoints: $("technicalPoints"),
  career: $("careerWalkthrough"), careerSummary: $("careerSummary"), careerOverview: $("careerOverview"), careerRoles: $("careerRoles"),
  careerRole: $("careerRole"), careerProgress: $("careerProgress"), careerPrev: $("careerPrev"), careerNext: $("careerNext"),
  careerSlider: $("careerSlider"), careerOrder: $("careerOrder"), careerClose: $("careerClose"),
  careerAllRoles: $("careerAllRoles"),
  resumeAnswerBox: $("resumeAnswerBox"), resumeAnswerScope: $("resumeAnswerScope"), resumeAnswerText: $("resumeAnswerText"), careerDetails: $("careerTimelineDetails"),
  careerTitle: $("careerTitle"), experienceDuration: $("experienceDuration"), experienceExamples: $("experienceExamples"), experienceStories: $("experienceStories"),
};

// Detected questions, newest last. Each: {id, at, hint, status}. status drives the action chips.
let questions = [];
let selectedId = null;
let qSeq = 0;

let settings;
let nextSettings;
let sessionId = null;
let transcriptName = "";
let streams = { interviewer: null, candidate: null };
let media = { interviewer: null, candidate: null };
let transcript = [];                 // final lines: {speaker, text, t}
let interim = { interviewer: null, candidate: null };
let interimNodes = {};
let captionSamples = [];
let scheduler = new HintScheduler();  // coalesces interviewer speech, gates hint calls
let hintTimer = null;
let lastHint = null;                 // last validated hint, so follow-ups keep the same story
let talkStart = null, talkTimer = null;
let lastCandidateAt = 0;             // last time the candidate's mic produced speech
// Trace points for the whole session. Always recorded (cheap); printed to the console and saved
// next to the transcript only in developer mode (Settings → Diagnostics).
const trace = createTrace({ onMark: (e) => { if (settings?.devMode) console.debug(`+${e.t}ms ${e.event}`, e); } });
let sessionStart = null;
let sessionVersion = 0;
const capturePending = { interviewer: null, candidate: null };

function setStatus(msg, isError = false) {
  if (isError) trace.mark("status.error", { msg });
  ui.status.textContent = msg;
  ui.status.classList.toggle("error", isError);
}

// --- Transcript rendering --------------------------------------------------

function renderTranscript() {
  ui.transcript.innerHTML = "";
  interimNodes = {};
  const lines = transcript.slice(-60);
  for (const l of lines) ui.transcript.appendChild(lineEl(l.speaker, l.text, false));
  for (const sp of ["interviewer", "candidate"]) {
    renderInterim(sp);
  }
  ui.transcript.scrollTop = ui.transcript.scrollHeight;
  ui.save.disabled = transcript.length === 0;
}

// Interim words update one node immediately. Rebuilding all 60 history rows on every
// partial result made fast captions unnecessarily expensive while hints were streaming.
function renderInterim(speaker) {
  if (!interim[speaker]) return;
  let node = interimNodes[speaker];
  if (!node) {
    const el = lineEl(speaker, interim[speaker], true);
    node = interimNodes[speaker] = { el, text: el.lastChild };
    ui.transcript.appendChild(el);
  } else node.text.nodeValue = interim[speaker];
  ui.transcript.scrollTop = ui.transcript.scrollHeight;
}

function lineEl(speaker, text, isInterim) {
  const el = document.createElement("div");
  el.className = `line ${speaker}${isInterim ? " interim" : ""}`;
  const who = document.createElement("span");
  who.className = "who";
  who.textContent = speaker === "interviewer" ? "Interviewer" : (transcriptName || settings.candidateName || "You");
  if (isInterim) who.textContent += " · live";
  el.appendChild(who);
  el.appendChild(document.createTextNode(text));
  return el;
}

// --- Speech events -----------------------------------------------------------

function onInterim({ speaker, text, backlogMs = null }) {
  const t0 = performance.now();
  if (interim[speaker] === null) trace.mark("stt.interim.start", { speaker });
  interim[speaker] = text;
  if (speaker === "candidate") { lastCandidateAt = Date.now(); scheduler.onCandidateSpeaks(); if (!talkStart) startTalkClock(); }
  renderInterim(speaker);
  const renderMs = Math.round((performance.now() - t0) * 100) / 100;
  captionSamples.push({ backlogMs, renderMs });
  if (captionSamples.length > 200) captionSamples.shift();
  if (settings.devMode) trace.mark("caption.update", { speaker, backlogMs, renderMs });
}

function onFinal({ speaker, text, speechFinal }) {
  trace.mark("stt.final", { speaker, chars: text.length, speechFinal: !!speechFinal });
  interim[speaker] = null;
  mergeFinal(transcript, { speaker, text });
  checkpointTranscript();
  renderTranscript();

  if (speaker === "interviewer") {
    stopTalkClock();
    schedule(scheduler.onInterviewerFinal({ text, speechFinal }, Date.now()));
  }
}

function onUtteranceEnd({ speaker }) {
  trace.mark("stt.utteranceEnd", { speaker });
  if (speaker === "interviewer") schedule(scheduler.onUtteranceEnd(Date.now()));
}

function schedule(plan) {
  if (!plan) return;
  trace.mark("sched.plan", { fireInMs: plan.fireInMs });
  clearTimeout(hintTimer);
  hintTimer = setTimeout(requestHint, plan.fireInMs);
}

// --- Hints -----------------------------------------------------------------

// Seed the prompt cache so the first hint of the session reads it instead of writing it
// (measured: 2.6-5.4 s cold vs 2.0 s warm). One output token; failures are logged, never shown.
let prewarmTimer = null, lastCacheTouch = 0;
const CACHE_REFRESH_MS = 50 * 60 * 1000; // the 1h TTL is refreshed by every hint; only a long silence needs this
function prewarm(reason) {
  if (!settings.anthropicKey) return;
  clearTimeout(prewarmTimer);
  const version = sessionVersion;
  prewarmTimer = setTimeout(async () => {
    if (version !== sessionVersion || sessionStart === null) return;
    const t = trace.mark("cache.prewarm.start", { reason });
    try {
      const r = await prewarmHint({ apiKey: settings.anthropicKey, model: settings.model, stories: settings.stories, jobDescription: settings.jobDescription, cvText: settings.cvText, resources: settings.resources, tier: settings.contextTier });
      if (version !== sessionVersion) return;
      lastCacheTouch = Date.now();
      trace.mark("cache.prewarm.done", { ms: Math.round(r.ms), write: r.usage.cache_creation_input_tokens || 0, read: r.usage.cache_read_input_tokens || 0 });
    } catch (e) {
      trace.mark("cache.prewarm.error", { error: e.message });
      console.warn("cache prewarm failed:", e.message);
    }
  }, reason === "session start" ? 0 : 1500); // settings autosave fires often; coalesce
}

// Partial hints arrive on every streamed token (~80 per hint). Render at most once per frame.
let pendingPartial = null, partialFrame = 0;
function renderPartial(h) {
  pendingPartial = h;
  if (partialFrame) return;
  partialFrame = requestAnimationFrame(() => { partialFrame = 0; if (pendingPartial) renderHint(pendingPartial, { partial: true }); pendingPartial = null; });
}

async function requestHint() {
  clearTimeout(hintTimer);
  if (sessionStart === null) return;
  const version = sessionVersion;
  const hintScheduler = scheduler;
  const q = scheduler.take(Date.now());
  if (q === null) {
    // Gate or in-flight blocked us; the done() path or the next speech event reschedules.
    if (!scheduler.inFlight && scheduler.pending) schedule({ fireInMs: scheduler.nextDelay(Date.now()) });
    return;
  }
  if (partialFrame) cancelAnimationFrame(partialFrame);
  partialFrame = 0; pendingPartial = null;
  const t0 = performance.now();
  const sinceFinal = trace.since("stt.final");
  trace.mark("hint.request", { chars: q.length, sinceSttFinalMs: sinceFinal, model: settings.model });
  let res = null;
  let shownPartial = false;
  let preparedHint = null;
  const topicIntent = experienceIntent(q, lastHint);
  const route = (hint) => {
    const routed = routeQuestionHint(hint, q, lastHint);
    return routed?.question_type === "career_walkthrough" && preparedResume(settings.resources)
      ? { ...routed, career_overview: [], keywords: [], answer_shape: [], watch_out: "" } : routed;
  };
  if (topicIntent || isCareerWalkthrough(q)) {
    const preview = route({ is_question: true, question_summary: topicIntent ? `Experience with ${topicIntent.topic}` : "Walk through your career", question_type: "career_walkthrough",
      career_overview: [], stories: [], keywords: [], cv_leads: [], answer_shape: [], follow_ups: [], watch_out: "" });
    if (preview.question_type === "career_walkthrough" && preparedResume(settings.resources)) preparedHint = preview;
    else renderHint(preview, { partial: true });
    shownPartial = true;
  }
  const titles = settings.stories.map((s) => s.title);
  setHintState("Analysing\u2026");
  try {
    if (preparedHint) {
      const hint = route(validateHint(preparedHint, titles).hint);
      addQuestion(hint); lastHint = hint;
      setHintState("");
      setStatus("Showing your prepared resume answer");
      trace.mark("hint.prepared", { kind: "resume_summary", ms: Math.round(performance.now() - t0) });
      return;
    }
    res = await getHint({
      apiKey: settings.anthropicKey, model: settings.model, transcript, question: q,
      stories: settings.stories, jobDescription: settings.jobDescription, cvText: settings.cvText,
      resources: settings.resources, questions, lastHint, tier: settings.contextTier,
      onFirstToken: (ms) => { if (version === sessionVersion) trace.mark("hint.ttft", { ms: Math.round(ms) }); },
      // Show what has streamed so far: the question, stories and keywords arrive about a
      // second before the answer shape does. Provisional until the final validated hint.
      onPartial: (p) => {
        if (version !== sessionVersion) return;
        const h = route(provisionalHint(route(p), titles));
        if (!h) return;
        if (!shownPartial) { shownPartial = true; trace.mark("hint.partial", { ms: Math.round(performance.now() - t0), stories: h.stories.length, keywords: h.keywords.length }); }
        renderPartial(h);
      },
    });
    if (version !== sessionVersion) return;
    if (partialFrame) { cancelAnimationFrame(partialFrame); partialFrame = 0; } pendingPartial = null;
    const { ok, errors, hint: validated } = validateHint(route(res.hint), titles);
    const hint = route(validated);
    if (errors.length) { console.warn("hint validator:", errors); trace.mark("hint.validator", { dropped: errors.length, errors }); }
    if (!ok) throw new Error("Hint rejected by validator; see console.");
    if (hint.is_question) { addQuestion(hint); lastHint = hint; }
    else { if (shownPartial) clearHintCard(); setHintState(""); }
    const cached = !!res.usage.cache_read_input_tokens;
    lastCacheTouch = Date.now();
    trace.mark("hint.done", { ms: Math.round(res.ms), ttftMs: Math.round(res.ttftMs ?? 0), cached, isQuestion: hint.is_question, out: res.usage.output_tokens, sinceSttFinalMs: trace.since("stt.final") });
    setStatus(settings.devMode
      ? `Hint: first token ${Math.round(res.ttftMs ?? 0)} ms, done ${Math.round(res.ms)} ms${cached ? ", cached" : ""}${sinceFinal != null ? `, ${Math.round(sinceFinal)} ms after speech` : ""}`
      : `Hint in ${Math.round(res.ms)} ms${cached ? ", cached" : ""}`);
    recordDiag({ ms: res.ms, usage: res.usage, model: res.model, ok: true });
  } catch (e) {
    if (version !== sessionVersion) return;
    if (partialFrame) cancelAnimationFrame(partialFrame);
    partialFrame = 0; pendingPartial = null;
    trace.mark("hint.error", { ms: Math.round(performance.now() - t0), error: e.message });
    setHintState(e.message, true);
    setStatus(e.message, true);
    recordDiag({ ms: performance.now() - t0, usage: res?.usage, model: res?.model || settings.model, ok: false, error: e.message });
  } finally {
    const plan = hintScheduler.done(Date.now());
    if (version === sessionVersion) schedule(plan);
  }
}

async function recordDiag(info) {
  const entry = makeEntry(info);
  console.info("hint diag", entry);
  const { diag = [] } = await chrome.storage.local.get("diag");
  await chrome.storage.local.set({ diag: pushEntry(diag, entry) });
}

// Back to the waiting state: no question selected, nothing stale left on the card.
function clearHintCard() {
  ui.hint.classList.add("empty");
  ui.hint.classList.remove("partial");
  ui.hintState.textContent = "";
  ui.hintActions.hidden = true;
  ui.qtype.textContent = "";
  ui.question.textContent = "Waiting for a question\u2026";
  ui.stories.innerHTML = ""; ui.keywords.innerHTML = ""; ui.watch.textContent = "";
  ui.gapNotice.hidden = true; ui.shapeBox.hidden = true; ui.cvLeads.hidden = true;
  ui.technicalNotes.hidden = true; ui.technicalPoints.innerHTML = "";
  ui.career.hidden = true; ui.stories.hidden = false;
  ui.resumeAnswerBox.hidden = true; ui.resumeAnswerText.textContent = "";
}

// A new validated hint that is a real question. See lib/questionQueue.js for why a hint
// arriving while the interviewer is still talking updates the last entry in place.
function addQuestion(h) {
  const last = questions[questions.length - 1];
  if (shouldSupersede({ last, hint: h, now: Date.now(), lastCandidateAt })) {
    last.hint = h;
    last.at = Date.now();
    selectedId = last.id;
  } else {
    settleAnswering(questions, { lastCandidateAt }); // the one being answered is now done
    const q = { id: ++qSeq, at: Date.now(), hint: h, status: "new" };
    questions.push(q);
    selectedId = q.id;
  }
  renderQueue();
  renderHint(h);
  ui.hint.classList.add("fresh");
  setTimeout(() => ui.hint.classList.remove("fresh"), 1500);
}

const STATUS_LABEL = { new: "", answering: "Answering", answered: "Answered", later: "Later", dismissed: "Moved on" };

function renderQueue() {
  ui.questions.innerHTML = "";
  if (!questions.length) {
    const li = document.createElement("li");
    li.className = "qEmpty";
    li.textContent = "Detected questions will appear here. Click one to bring its hint back.";
    ui.questions.appendChild(li);
    return;
  }
  for (const q of queueOrder(questions)) {
    const li = document.createElement("li");
    li.className = `qItem status-${q.status}${q.id === selectedId ? " selected" : ""}`;

    const when = document.createElement("span");
    when.className = "qWhen";
    when.textContent = new Date(q.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

    const text = document.createElement("span");
    text.className = "qText";
    const gap = hasStoryGap(q.hint);
    text.textContent = `${gap ? "\u26a0 " : ""}${q.hint.question_summary || "(question)"}`;
    if (gap) text.title = "No story in your bank fits this question";

    li.append(when, text);
    if (STATUS_LABEL[q.status]) {
      const tag = document.createElement("span");
      tag.className = "qStatus";
      tag.textContent = STATUS_LABEL[q.status];
      li.appendChild(tag);
    }

    if (q.status === "answering") {
      const done = document.createElement("button");
      done.className = "qX";
      done.textContent = "\u2713";
      done.title = "Mark answered";
      done.onclick = (e) => { e.stopPropagation(); setQuestionStatus(q, "answered"); };
      li.appendChild(done);
    }
    const x = document.createElement("button");
    x.className = "qX";
    if (LIVE(q)) {
      x.textContent = "\u2715";
      x.title = "Move on: drop to the bottom of the list";
      x.onclick = (e) => { e.stopPropagation(); setQuestionStatus(q, "dismissed"); };
    } else {
      x.textContent = "\u21ba Bring back";
      x.title = "Bring this question back up";
      x.onclick = (e) => { e.stopPropagation(); setQuestionStatus(q, "new"); selectedId = q.id; renderQueue(); renderHint(q.hint); };
    }
    li.appendChild(x);

    li.onclick = () => { selectedId = q.id; renderQueue(); renderHint(q.hint); };
    ui.questions.appendChild(li);
  }
}

// Set a question's triage state. Dismissing the selected one hands focus to the newest live question.
function setQuestionStatus(q, status) {
  q.status = status;
  if (!LIVE(q) && q.id === selectedId) {
    const next = [...questions].reverse().find(LIVE);
    selectedId = next ? next.id : null;
    if (next) renderHint(next.hint);
    else clearHintCard();
  }
  renderQueue();
}

let careerView = { key: "", index: 0, newest: false };
let careerCv = null, allCareerRoles = [], careerRoles = [];
let experienceHint = null;
let experienceQuestionHint = null;
let displayedResume = null;

function usedStoryButton(question, title) {
  const button = document.createElement("button"); button.className = "small";
  button.textContent = question.usedStories?.includes(title) ? "Used ✓ — undo" : "Used this story";
  button.onclick = () => {
    const used = new Set(question.usedStories || []);
    if (used.has(title)) used.delete(title); else used.add(title);
    question.usedStories = [...used]; renderHint(question.hint);
  };
  return button;
}

function preparedExample(story) {
  const detail = document.createElement("details"), summary = document.createElement("summary");
  summary.textContent = `Prepared story: ${story.title} — role/dates unconfirmed`; detail.appendChild(summary);
  const note = document.createElement("small"); note.textContent = "Prepared example; its role connection and dates are not independently established."; detail.appendChild(note);
  const question = questions.find(q => q.id === selectedId && q.hint === experienceQuestionHint);
  if (question) detail.appendChild(usedStoryButton(question, story.title));
  for (const [label, key] of [["Situation", "situation"], ["Action", "action"], ["Result", "result"]]) {
    if (!story[key]) continue;
    const line = document.createElement("p"); line.textContent = `${label}: ${story[key]}`; detail.appendChild(line);
  }
  return detail;
}

function renderCareer(h) {
  const topicMode = h.question_type === "topic_experience";
  ui.career.hidden = !topicMode && h.question_type !== "career_walkthrough";
  const prepared = !ui.career.hidden && !topicMode ? preparedResume(settings.resources) : null;
  ui.resumeAnswerBox.hidden = !prepared;
  ui.resumeAnswerText.textContent = prepared?.text || "";
  if (ui.career.hidden) return;
  ui.resumeAnswerScope.textContent = prepared ? `${materialOwner(prepared) === "job" ? "For this job" : "For this candidate, across jobs"} · Shown as you saved it` : "";
  if (careerCv !== settings.cvText) {
    careerCv = settings.cvText || "";
    allCareerRoles = careerTimeline(careerCv);
  }
  const previous = (careerView.newest ? [...careerRoles].reverse() : careerRoles)[careerView.index]?.roleIndex;
  const key = h.career_key || h.question_summary;
  const sameQuestion = careerView.key === key;
  if (!sameQuestion || displayedResume !== prepared) ui.careerDetails.open = !prepared;
  displayedResume = prepared;
  if (!sameQuestion) careerView = { key, index: 0, newest: false };
  const evidence = tierIncludes(settings.contextTier).cvText ? h.experience_evidence || [] : [];
  const entries = topicMode ? topicTimeline(allCareerRoles, h.experience_topic || "", evidence) : [];
  const acceptedEvidence = evidence.filter(e => quoteFromRole(allCareerRoles[e.role - 1], e.quote));
  experienceHint = topicMode ? { ...h, experience_evidence: acceptedEvidence } : null;
  experienceQuestionHint = topicMode ? h : null;
  careerRoles = topicMode ? entries.map(e => ({ ...e.role, roleIndex: e.roleIndex, topicQuotes: e.quotes, direct: e.direct }))
    : allCareerRoles.map((role, i) => ({ ...role, roleIndex: i + 1 }));
  if (sameQuestion && previous) {
    const nextIndex = (careerView.newest ? [...careerRoles].reverse() : careerRoles).findIndex(role => role.roleIndex === previous);
    if (nextIndex >= 0) careerView.index = nextIndex;
  }
  ui.careerTitle.textContent = topicMode ? `Experience with ${h.experience_topic || "the requested topic"}` : "Career walkthrough";
  ui.careerOrder.value = careerView.newest ? "newest" : "oldest";
  ui.careerOverview.innerHTML = "";
  for (const cue of (prepared ? [] : topicMode ? h.experience_outline : h.career_overview) || []) {
    const li = document.createElement("li"); li.textContent = cue; ui.careerOverview.appendChild(li);
  }
  const first = careerRoles[0], last = careerRoles.at(-1);
  ui.careerSummary.textContent = prepared ? "Use your prepared answer above. Open the CV timeline for supporting roles and follow-up details."
    : topicMode ? first
    ? `${careerRoles.length} relevant roles · ${first.from} → ${last.to}. Connect early exposure, development and recent work to this job.`
    : "No dated role evidence found for this topic yet. Check the source mentions and prepared examples; missing dates do not establish no experience."
    : first
    ? `${careerRoles.length} roles · ${first.from} → ${last.to}. Start with a brief overview, then follow the roles and close with the fit for this job.`
    : careerCv ? "Dated roles could not be separated reliably. Use the CV below to walk through the complete history."
      : "Upload or paste the candidate's CV in Settings to see the complete career timeline.";
  ui.experienceDuration.hidden = !topicMode || !h.experience_asks_duration;
  ui.experienceDuration.innerHTML = "";
  if (!ui.experienceDuration.hidden) {
    const duration = experienceDuration(entries, new Date(sessionStart || Date.now()));
    const title = document.createElement("b"); title.textContent = duration.label;
    const caveat = document.createElement("small"); caveat.textContent = duration.caveat;
    ui.experienceDuration.append(title, caveat);
  }
  ui.experienceStories.innerHTML = "";
  const names = new Set([...(h.stories || []).map(s => s.title.toLowerCase()), ...acceptedEvidence.map(e => e.story?.toLowerCase()).filter(Boolean)]);
  const examples = topicMode ? (settings.stories || []).filter(story => names.has(story.title.toLowerCase())
    || topicMatches([story.title, story.tags, story.situation, story.action, story.result].filter(Boolean).join(" "), h.experience_topic || "")) : [];
  for (const example of examples) ui.experienceStories.appendChild(preparedExample(example));
  ui.experienceExamples.hidden = !examples.length;
  ui.careerClose.textContent = topicMode ? "Connect the stages with what changed in scope or depth, then close with relevance to this job. Confirm any duration before quoting it."
    : "Close by connecting the relevant experience to this job. Explain transitions in your own words.";
  ui.careerClose.hidden = !careerRoles.length && !examples.length;
  renderCareerRole();
}

function renderCareerRole() {
  const roles = careerView.newest ? [...careerRoles].reverse() : careerRoles;
  careerView.index = Math.max(0, Math.min(careerView.index, roles.length - 1));
  ui.careerRoles.innerHTML = "";
  ui.careerAllRoles.textContent = `All ${roles.length} ${experienceHint ? "relevant " : ""}roles — jump to any role`;
  roles.forEach((role, index) => {
    const button = document.createElement("button");
    button.textContent = `${index + 1}. ${role.employer || role.title} · ${role.from}`;
    if (index === careerView.index) button.setAttribute("aria-current", "step");
    button.onclick = () => { careerView.index = index; renderCareerRole(); };
    ui.careerRoles.appendChild(button);
  });
  ui.careerRole.innerHTML = "";
  const role = roles[careerView.index];
  ui.careerProgress.textContent = role ? `Role ${careerView.index + 1} of ${roles.length}` : "";
  ui.careerPrev.disabled = !role || careerView.index === 0;
  ui.careerNext.disabled = !role || careerView.index === roles.length - 1;
  ui.careerSlider.disabled = !role;
  ui.careerOrder.disabled = !role;
  ui.careerSlider.max = String(Math.max(0, roles.length - 1));
  ui.careerSlider.value = String(careerView.index);
  ui.careerSlider.setAttribute("aria-valuetext", role ? `${role.title}, ${role.employer}, ${role.dates}` : "No dated roles");
  if (!role) {
    const cv = document.createElement("pre"); cv.className = "careerSource";
    const mentions = experienceHint ? careerCv.split("\n").filter(line => topicMatches(line, experienceHint.experience_topic || "")) : [];
    cv.textContent = experienceHint ? mentions.length ? `CV mentions (dates not established):\n${mentions.join("\n")}` : "No supporting CV mention found. Review your notes and prepared examples for additional context." : careerCv;
    ui.careerRole.appendChild(cv);
    return;
  }
  const title = document.createElement("h3"); title.textContent = role.title;
  const employer = document.createElement("p"); employer.textContent = role.employer;
  const dates = document.createElement("p"); dates.textContent = role.dates;
  ui.careerRole.append(title, employer, dates);
  const list = (points) => {
    const ul = document.createElement("ul");
    for (const text of points) { const li = document.createElement("li"); li.textContent = text; ul.appendChild(li); }
    return ul;
  };
  const points = experienceHint ? role.topicQuotes : role.highlights;
  if (experienceHint && !role.direct) {
    const related = document.createElement("p"); related.textContent = "Related role suggested by the model — confirm the topic connection. Not counted toward duration.";
    ui.careerRole.appendChild(related);
  }
  ui.careerRole.appendChild(list(points.slice(0, 3)));
  if (experienceHint) {
    const linked = new Set((experienceHint.experience_evidence || []).filter(e => e.role === role.roleIndex
      && role.topicQuotes.some(q => q.toLowerCase().includes(e.quote.toLowerCase()))).map(e => e.story?.toLowerCase()).filter(Boolean));
    for (const story of settings.stories || []) if (linked.has(story.title.toLowerCase())) ui.careerRole.appendChild(preparedExample(story));
  }
  if (role.highlights.length > 3) {
    const details = document.createElement("details"), summary = document.createElement("summary");
    summary.textContent = "More from this role"; details.append(summary, list(role.highlights.slice(3)));
    ui.careerRole.appendChild(details);
  }
}

function renderHint(h, { partial = false } = {}) {
  ui.hint.classList.remove("empty");
  ui.hint.classList.toggle("partial", partial);
  ui.hintState.textContent = partial ? "\u2026" : "";
  ui.hintState.className = "hintState";
  const typeLabel = h.question_type === "career_walkthrough" ? "Career walkthrough" : h.question_type === "topic_experience" ? "Experience storyline" : h.question_type;
  const usingPrepared = h.question_type === "career_walkthrough" && preparedResume(settings.resources);
  ui.qtype.textContent = h.follow_up ? `${typeLabel} \u00b7 follow-up` : typeLabel;
  ui.question.textContent = h.question_summary;
  renderCareer(h);
  ui.technicalPoints.innerHTML = "";
  for (const point of h.technical_points || []) {
    const li = document.createElement("li"); li.textContent = point;
    ui.technicalPoints.appendChild(li);
  }
  ui.technicalNotes.hidden = h.question_type !== "technical" || !h.technical_points?.length;
  ui.stories.innerHTML = "";
  ui.stories.hidden = ["career_walkthrough", "topic_experience"].includes(h.question_type);
  for (const s of h.stories) {
    const el = document.createElement("div");
    el.className = "story";
    const b = document.createElement("b"); b.textContent = s.title;
    const span = document.createElement("span"); span.textContent = s.cue;
    el.append(b, span);
    const q = !partial && questions.find((item) => item.id === selectedId && item.hint === h);
    if (q) el.appendChild(usedStoryButton(q, s.title));
    const beats = s.beats?.length ? s.beats : [];
    if (beats.length) {
      const ul = document.createElement("ul"); ul.className = "beats";
      for (const t of beats) { const li = document.createElement("li"); li.textContent = t; ul.appendChild(li); }
      el.appendChild(ul);
    }
    // The result line is the candidate's own text from the bank: free, exact, and the thing
    // most often forgotten under pressure.
    const bank = settings.stories?.find((x) => x.title.trim().toLowerCase() === s.title.toLowerCase());
    if (bank?.result) {
      const r = document.createElement("div"); r.className = "result";
      r.textContent = `Result: ${bank.result.length > 140 ? `${bank.result.slice(0, 140)}\u2026` : bank.result}`;
      el.appendChild(r);
    }
    ui.stories.appendChild(el);
  }
  ui.keywords.innerHTML = "";
  for (const k of usingPrepared ? [] : h.keywords) {
    const el = document.createElement("span"); el.className = "kw"; el.textContent = k;
    ui.keywords.appendChild(el);
  }
  ui.watch.textContent = usingPrepared ? "" : h.watch_out;

  // A question with no story behind it is the thing the candidate most needs to know,
  // both live (improvise honestly, do not stall) and afterwards (a gap to prepare).
  const noStory = !partial && hasStoryGap(h);
  ui.gapNotice.hidden = !noStory;
  if (noStory) {
    const leads = h.cv_leads?.length;
    ui.gapNotice.textContent = settings.stories?.length
      ? (leads ? "No story in your bank fits this one \u2014 the CV pointers below are your own history; add a story for it afterwards."
               : "No story in your bank fits this one \u2014 answer from memory, and add a story for it afterwards.")
      : (leads ? "Your story bank is empty. The coach can only point at your CV below; add stories for real cues."
               : "Your story bank is empty, so there is nothing to point at. Hints stay generic until you add stories.");
  }

  const shape = usingPrepared ? [] : h.answer_shape || [];
  const ups = h.follow_ups || [];
  ui.answerShape.innerHTML = "";
  for (const s of shape) {
    const li = document.createElement("li");
    li.textContent = s;
    ui.answerShape.appendChild(li);
  }
  ui.followUps.innerHTML = "";
  for (const f of ups) {
    const d = document.createElement("div");
    d.className = "fu";
    d.textContent = `\u2192 ${f}`;
    ui.followUps.appendChild(d);
  }
  ui.shapeBox.hidden = !(shape.length || ups.length);

  ui.cvLeads.innerHTML = "";
  const leads = h.cv_leads || [];
  if (leads.length) {
    const lab = document.createElement("span"); lab.className = "leadLabel";
    lab.textContent = h.question_type === "technical" ? "Relevant CV context:" : h.stories.length ? "Also in your CV:" : "From your CV (no story yet):";
    ui.cvLeads.appendChild(lab);
    for (const l of leads) {
      const el = document.createElement("span"); el.className = "kw lead"; el.textContent = l;
      ui.cvLeads.appendChild(el);
    }
  }
  ui.cvLeads.hidden = !leads.length;

  renderActions();
  ui.hintActions.hidden = partial; // chips need a queue entry, which only the final hint creates
}

// The chips mirror the selected question's state, so "Answer this" reads "Answering ✓ done"
// once clicked and a second tap marks it answered instead of silently clearing it.
const ACT_LABEL = { answering: "Answer this", later: "Think about it", dismissed: "Move on" };
function renderActions() {
  const q = questions.find((x) => x.id === selectedId);
  for (const b of ui.hintActions.querySelectorAll("[data-act]")) {
    const act = b.dataset.act;
    const on = q && q.status === act;
    b.classList.toggle("on", !!on);
    b.textContent = on && act === "answering" ? "Answering \u2014 tap when done" : ACT_LABEL[act];
  }
}

// Without a story bank, hints can only ever be generic keywords, which is the single
// biggest cause of "the AI said nothing useful". Say so permanently, not in a status line
// that the next message overwrites.
function renderBankWarning() {
  const empty = !settings.stories?.length;
  ui.bankWarn.hidden = !empty;
}

// Show that a hint request is in flight, or surface why it failed, right on the card.
function setHintState(text, isError = false) {
  ui.hintState.textContent = text;
  ui.hintState.className = `hintState${isError ? " error" : ""}`;
}

// Questions that had no story behind them: the candidate's prep list for next time.
function gapQuestions() {
  return questions.filter((q) => hasStoryGap(q.hint)).map((q) => q.hint.question_summary);
}

function sessionMetadata() {
  return { id: sessionId, start: sessionStart,
    candidateId: settings.profiles?.activeCandidate ?? null, candidateName: settings.candidateName || "",
    jobId: settings.profiles?.activeJob ?? null, jobTitle: settings.jobTitle || "", captions: captionSummary(captionSamples) };
}

function checkpointTranscript() {
  if (!sessionId || sessionStart === null || !transcript.length) return;
  saveSessionDraft({ ...sessionMetadata(), end: Date.now(), lines: transcript.map((l) => ({ ...l })) })
    .catch((e) => setStatus(`Could not save recovery checkpoint: ${e.message}. Use Save transcript.`, true));
}

function reportGaps() {
  const gaps = gapQuestions();
  if (!gaps.length) return;
  setStatus(`${gaps.length} question${gaps.length === 1 ? "" : "s"} had no matching story. Saved with the transcript \u2014 add stories for them in Settings.`, true);
}

// Full conversation to a text file the candidate keeps.
function saveTranscript() {
  if (!transcript.length) return;
  const header = `Interview transcript\n${new Date(sessionStart || Date.now()).toLocaleString()}\n\n`;
  const body = transcript.map((l) => `${l.speaker === "interviewer" ? "Interviewer" : (transcriptName || settings.candidateName || "You")}: ${l.text}`).join("\n");
  const gaps = gapQuestions();
  const gapBlock = gaps.length
    ? `\n--- Questions with no matching story (add these to your bank) ---\n${gaps.map((g) => `- ${g}`).join("\n")}\n`
    : "";
  const blob = new Blob([header + body + "\n" + gapBlock], { type: "text/plain" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
  a.download = `interview-${stamp}.txt`;
  a.click();
  URL.revokeObjectURL(a.href);
  if (settings.devMode && trace.entries.length) {
    const tb = new Blob([`Interview Coach trace (ms from session start)\n${formatTrace(trace.entries)}\n`], { type: "text/plain" });
    const ta = document.createElement("a");
    ta.href = URL.createObjectURL(tb);
    ta.download = `interview-${stamp}.trace.log`;
    ta.click();
    URL.revokeObjectURL(ta.href);
  }
}

// --- Talk clock ------------------------------------------------------------

function startTalkClock() {
  talkStart = Date.now();
  talkTimer = setInterval(() => {
    const s = Math.round((Date.now() - talkStart) / 1000);
    ui.talk.textContent = `${s}s`;
    ui.paceWarn.textContent = s > 120 ? "Over two minutes. Land the result." : s > 90 ? "Wrap up soon." : "";
    ui.paceWarn.className = s > 120 ? "over" : "";
  }, 1000);
}
function stopTalkClock() {
  clearInterval(talkTimer); talkStart = null; talkTimer = null;
  ui.talk.textContent = "0s"; ui.paceWarn.textContent = "";
}

// --- Capture -----------------------------------------------------------------

// First capture of a new session: forget the previous interview so it is not appended to.
function beginSessionIfNeeded() {
  if (sessionStart !== null) return;
  settings = structuredClone(nextSettings || settings);
  transcriptName = settings.candidateName || "";
  captionSamples = [];
  careerView = { key: "", index: 0, newest: false };
  sessionId = crypto.randomUUID();
  sessionVersion++;
  sessionStart = Date.now();
  trace.reset();
  trace.mark("session.start", { provider: settings.sttProvider, model: settings.model, tier: settings.contextTier, stories: settings.stories?.length || 0 });
  transcript = [];
  interim = { interviewer: null, candidate: null };
  lastHint = null;
  scheduler = new HintScheduler();
  lastCandidateAt = 0;
  prewarm("session start");
  clearTimeout(hintTimer);
  questions = []; selectedId = null;
  renderTranscript();
  renderQueue();
  clearHintCard();
}

// The key for whichever STT provider is selected in Settings.
function sttKey() {
  return settings.sttProvider === "assemblyai" ? settings.assemblyaiKey : settings.deepgramKey;
}
function sttProviderName() {
  return settings.sttProvider === "assemblyai" ? "AssemblyAI" : "Deepgram";
}

function sttFor(speaker) {
  const version = sessionVersion;
  const current = (fn) => (...args) => { if (version === sessionVersion) fn(...args); };
  const opts = { apiKey: sttKey(), speaker, onInterim: current(onInterim), onFinal: current(onFinal), onUtteranceEnd: current(onUtteranceEnd), onError: current((e) => { trace.mark("stt.error", { speaker, msg: e.message }); setStatus(e.message, true); }) };
  const stream = settings.sttProvider === "assemblyai" ? new AssemblyAiStream(opts) : new SttStream(opts);
  stream.onStatus = current((msg) => setStatus(msg));
  return stream;
}

// --- The stage: the call's picture beside the coach ---------------------------------

let panelLayout;

// Muted on purpose: the call's audio goes to the captions and never back out of this window.
// selfBrowserSurface:"exclude" keeps this window out of the share picker, so the mirror can
// never show itself.
function attachCall(video) {
  if (!video) return detachCall();
  ui.callVideo.srcObject = new MediaStream([video]);
  ui.call.disabled = false;
  video.onended = () => { trace.mark("call.video.ended"); detachCall(); };
  const st = video.getSettings?.() || {};
  trace.mark("call.video.on", { w: st.width, h: st.height, fps: st.frameRate });
  layoutStage();
}

function detachCall() {
  ui.callVideo.srcObject = null;
  ui.call.disabled = true;
  layoutStage();
}

function layoutStage() {
  panelLayout?.update({ hasVideo: !!ui.callVideo.srcObject });
}

function toggleFullscreen() {
  if (document.fullscreenElement) return document.exitFullscreen();
  document.documentElement.requestFullscreen().catch((e) => setStatus(`Full screen refused: ${e.message}`, true));
}

async function captureTab() {
  if (!sttKey()) return setStatus(`Add a ${sttProviderName()} key in Settings first.`, true);
  try {
    // Chrome only offers the "Share tab audio" checkbox when video is requested too. The video
    // track is the picture of the call shown beside the coach (see attachCall).
    const stream = await captureSource("interviewer", () => navigator.mediaDevices.getDisplayMedia({ video: true, audio: true, selfBrowserSurface: "exclude" }), () => sttFor("interviewer"));
    if (!stream) return;
    const { video } = callTracks(stream);
    attachCall(video);
    setStatus(video ? "Call live. Choose a layout above; now capture your mic." : "Call audio live. Now capture your mic.");
  } catch (e) { setStatus(e.message, true); }
}

async function captureMic() {
  const useBuiltin = !sttKey() && settings.sttProvider !== "assemblyai";
  if (!sttKey() && settings.sttProvider === "assemblyai") return setStatus("Add an AssemblyAI key in Settings first.", true);
  if (useBuiltin && !WebSpeechStream.supported()) return setStatus("Add a Deepgram key in Settings first.", true);
  try {
    const stream = await captureSource("candidate", () => navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }), () => {
      if (!useBuiltin) return sttFor("candidate");
      const version = sessionVersion;
      const current = (fn) => (...args) => { if (version === sessionVersion) fn(...args); };
      return new WebSpeechStream({ speaker: "candidate", onInterim: current(onInterim), onFinal: current(onFinal), onUtteranceEnd: current(onUtteranceEnd), onError: current((e) => setStatus(e.message, true)) });
    });
    if (!stream) return;
    setStatus(useBuiltin ? "Mic live via Chrome's built-in recognition (no Deepgram key). Call audio still needs a Deepgram key." : "Mic live. Good luck.");
  } catch (e) {
    if (e.name === "NotAllowedError" || e.name === "NotFoundError") {
      setStatus("", true);
      ui.status.textContent = "Chrome blocked the microphone for this window. ";
      const a = document.createElement("a");
      a.href = chrome.runtime.getURL("options.html#mic"); a.target = "_blank";
      a.textContent = "Grant it once in Settings → Test microphone, then retry.";
      ui.status.appendChild(a);
    } else setStatus(e.message, true);
  }
}

// A source owns one capture and one STT connection, including while permission or the
// connection handshake is pending. Stop invalidates that ownership before any await.
async function captureSource(speaker, acquire, createStt) {
  if (capturePending[speaker] || media[speaker]) return null;
  const token = capturePending[speaker] = {};
  const button = speaker === "interviewer" ? ui.tab : ui.mic;
  button.disabled = true;
  ui.stop.disabled = false;
  let stream, stt, started = false;
  try {
    stream = await acquire();
    if (capturePending[speaker] !== token) return null;
    const audio = stream.getAudioTracks()[0];
    if (!audio) throw new Error("No audio in that share. Pick the meeting *tab* and tick 'Share tab audio'.");
    beginSessionIfNeeded();
    media[speaker] = stream;
    stt = streams[speaker] = createStt();
    audio.onended = () => { if (media[speaker] === stream) stopAll(); };
    await stt.start(stream);
    if (capturePending[speaker] !== token) return null;
    started = true;
    button.classList.add("active");
    return stream;
  } catch (e) {
    if (capturePending[speaker] === token) throw e;
    return null; // a handshake cancelled by Stop must not overwrite the next session's status
  } finally {
    if (!started) {
      stt?.stop();
      stream?.getTracks().forEach((t) => t.stop());
      if (media[speaker] === stream) media[speaker] = null;
      if (streams[speaker] === stt) streams[speaker] = null;
    }
    if (capturePending[speaker] === token) capturePending[speaker] = null;
    button.disabled = !!media[speaker] || !!capturePending[speaker];
    ui.stop.disabled = !Object.values(media).some(Boolean) && !Object.values(capturePending).some(Boolean);
    if (ui.stop.disabled && !transcript.length) sessionStart = null;
  }
}

async function stopAll() {
  const metadata = sessionMetadata();
  const start = sessionStart;
  const lines = transcript.map((line) => ({ ...line }));
  const stoppedSettings = settings;
  const gaps = gapQuestions();
  const version = ++sessionVersion;
  sessionStart = null;
  clearTimeout(hintTimer); clearTimeout(prewarmTimer);
  if (partialFrame) cancelAnimationFrame(partialFrame);
  partialFrame = 0; pendingPartial = null;
  scheduler = new HintScheduler();
  for (const sp of ["interviewer", "candidate"]) {
    capturePending[sp] = null;
    streams[sp]?.stop(); streams[sp] = null;
    media[sp]?.getTracks().forEach((t) => t.stop()); media[sp] = null;
  }
  detachCall();
  stopTalkClock();
  ui.tab.classList.remove("active"); ui.mic.classList.remove("active"); ui.stop.disabled = true;
  ui.tab.disabled = false; ui.mic.disabled = false;
  if (lines.length && start !== null) {
    const end = Date.now();
    const session = { ...metadata, start, end, lines, pace: answerStats(lines, end), paceSummary: paceSummary(answerStats(lines, end)) };
    try { await appendTranscript(session); }
    catch (e) { setStatus(`Could not save transcript: ${e.message}. Use Save transcript to download it.`, true); return; }
    if (version === sessionVersion) setStatus("Stopped. Transcript saved. Writing debrief…");
    try {
      session.debrief = await debrief({ apiKey: stoppedSettings.anthropicKey, model: stoppedSettings.model, lines, stories: stoppedSettings.stories });
      await updateSession(session);
      if (version === sessionVersion) setStatus("Debrief ready in Settings → Past sessions.");
    } catch (e) { if (version === sessionVersion) setStatus(`Transcript saved; debrief failed: ${e.message}`, true); }
  } else setStatus("Stopped.");
  if (version === sessionVersion && gaps.length) setStatus(`${gaps.length} question(s) had no matching story. Saved with the transcript — add stories for them in Settings.`, true);
}

// --- Boot ------------------------------------------------------------------

(async () => {
  settings = nextSettings = await loadSettings();
  if (!settings.anthropicKey || !sttKey()) setStatus("Add your API keys in Settings before starting.", true);
  renderBankWarning();
  chrome.storage.onChanged.addListener(async (changes, area) => {
    if (area !== "local" || !Object.keys(changes).some((key) => key === "profiles" || ["anthropicKey", "deepgramKey", "assemblyaiKey", "sttProvider", "model", "contextTier", "devMode"].includes(key))) return;
    nextSettings = await loadSettings();
    // The active interview retains its candidate, job, provider and prompt until Stop.
    if (sessionStart === null) { settings = nextSettings; renderBankWarning(); }
  });
  try {
    const recovered = await recoverSessionDrafts();
    const last = recovered.at(-1);
    if (last) {
      transcript = last.lines; transcriptName = last.candidateName || "";
      renderTranscript();
      setStatus("Recovered an interrupted interview. Its transcript is saved in Settings → Past sessions; Save transcript downloads it.");
    }
  } catch (e) { setStatus(`Could not recover the previous interview: ${e.message}`, true); }
  // A session that sits quiet for most of an hour (late start, long intro) would lose the cache.
  setInterval(() => { if (sessionStart !== null && lastCacheTouch && Date.now() - lastCacheTouch > CACHE_REFRESH_MS) prewarm("cache refresh"); }, 60 * 1000);
  ui.tab.onclick = captureTab;
  ui.mic.onclick = captureMic;
  ui.stop.onclick = stopAll;
  ui.save.onclick = saveTranscript;
  panelLayout = createPanelLayout({ document, window, storage: () => localStorage, onChange: (preset) => trace.mark("layout.change", { preset }) });
  ui.full.onclick = toggleFullscreen;
  ui.careerPrev.onclick = () => { careerView.index--; renderCareerRole(); };
  ui.careerNext.onclick = () => { careerView.index++; renderCareerRole(); };
  ui.careerSlider.oninput = () => { careerView.index = Number(ui.careerSlider.value); renderCareerRole(); };
  ui.careerOrder.onchange = () => {
    careerView.index = Math.max(0, careerRoles.length - 1 - careerView.index);
    careerView.newest = ui.careerOrder.value === "newest";
    renderCareerRole();
  };
  document.addEventListener("fullscreenchange", () => { ui.full.textContent = document.fullscreenElement ? "Exit full screen" : "Full screen"; });
  let resizeFrame = 0;
  window.addEventListener("resize", () => { cancelAnimationFrame(resizeFrame); resizeFrame = requestAnimationFrame(layoutStage); });
  layoutStage();
  ui.hintActions.onclick = (e) => {
    const act = e.target.dataset?.act;
    if (!act) return;
    const q = questions.find((x) => x.id === selectedId);
    if (!q) return;
    // Tapping "Answer this" again means "I answered it"; the other chips toggle off.
    setQuestionStatus(q, q.status === act ? (act === "answering" ? "answered" : "new") : act);
    renderActions();
  };
})();
