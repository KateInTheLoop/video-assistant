import { loadSettings, appendTranscript, updateLastSession } from "./storage.js";
import { SttStream } from "./stt.js";
import { WebSpeechStream } from "./webspeech.js";
import { getHint, debrief } from "./claude.js";
import { mergeFinal } from "./lib/transcript.js";
import { HintScheduler } from "./lib/scheduler.js";
import { validateHint } from "./lib/hintSchema.js";
import { makeEntry, pushEntry } from "./lib/diag.js";
import { answerStats, paceSummary } from "./lib/pace.js";

const $ = (id) => document.getElementById(id);
const ui = {
  tab: $("btnTab"), mic: $("btnMic"), stop: $("btnStop"), status: $("status"),
  hint: $("hint"), qtype: $("qtype"), question: $("question"), stories: $("stories"),
  keywords: $("keywords"), watch: $("watch"), transcript: $("transcript"),
  talk: $("talk"), paceWarn: $("paceWarn"),
};

let settings;
let streams = { interviewer: null, candidate: null };
let media = { interviewer: null, candidate: null };
let transcript = [];                 // final lines: {speaker, text, t}
let interim = { interviewer: null, candidate: null };
const scheduler = new HintScheduler();  // coalesces interviewer speech, gates hint calls
let hintTimer = null;
let lastHint = null;                 // last validated hint, so follow-ups keep the same story
let talkStart = null, talkTimer = null;
let sessionStart = null;

function setStatus(msg, isError = false) {
  ui.status.textContent = msg;
  ui.status.classList.toggle("error", isError);
}

// --- Transcript rendering --------------------------------------------------

function renderTranscript() {
  ui.transcript.innerHTML = "";
  const lines = transcript.slice(-60);
  for (const l of lines) ui.transcript.appendChild(lineEl(l.speaker, l.text, false));
  for (const sp of ["interviewer", "candidate"]) {
    if (interim[sp]) ui.transcript.appendChild(lineEl(sp, interim[sp], true));
  }
  ui.transcript.scrollTop = ui.transcript.scrollHeight;
}

function lineEl(speaker, text, isInterim) {
  const el = document.createElement("div");
  el.className = `line ${speaker}${isInterim ? " interim" : ""}`;
  const who = document.createElement("span");
  who.className = "who";
  who.textContent = speaker === "interviewer" ? "Interviewer" : (settings.candidateName || "You");
  el.appendChild(who);
  el.appendChild(document.createTextNode(text));
  return el;
}

// --- Speech events -----------------------------------------------------------

function onInterim({ speaker, text }) {
  interim[speaker] = text;
  if (speaker === "candidate") { scheduler.onCandidateSpeaks(); if (!talkStart) startTalkClock(); }
  renderTranscript();
}

function onFinal({ speaker, text, speechFinal }) {
  interim[speaker] = null;
  mergeFinal(transcript, { speaker, text });
  renderTranscript();

  if (speaker === "interviewer") {
    stopTalkClock();
    schedule(scheduler.onInterviewerFinal({ text, speechFinal }, Date.now()));
  }
}

function onUtteranceEnd({ speaker }) {
  if (speaker === "interviewer") schedule(scheduler.onUtteranceEnd(Date.now()));
}

function schedule(plan) {
  if (!plan) return;
  clearTimeout(hintTimer);
  hintTimer = setTimeout(requestHint, plan.fireInMs);
}

// --- Hints -----------------------------------------------------------------

async function requestHint() {
  clearTimeout(hintTimer);
  const q = scheduler.take(Date.now());
  if (q === null) {
    // Gate or in-flight blocked us; the done() path or the next speech event reschedules.
    if (!scheduler.inFlight && scheduler.pending) schedule({ fireInMs: scheduler.nextDelay(Date.now()) });
    return;
  }
  const t0 = performance.now();
  let res = null;
  try {
    res = await getHint({
      apiKey: settings.anthropicKey, model: settings.model, transcript,
      stories: settings.stories, jobDescription: settings.jobDescription, cvText: settings.cvText, lastHint,
    });
    const { ok, errors, hint } = validateHint(res.hint, settings.stories.map((s) => s.title));
    if (errors.length) console.warn("hint validator:", errors);
    if (!ok) throw new Error("Hint rejected by validator; see console.");
    if (hint.is_question) { renderHint(hint); lastHint = hint; }
    const cached = res.usage.cache_read_input_tokens ? ", cached" : "";
    setStatus(`Hint in ${Math.round(res.ms)} ms${cached}`);
    recordDiag({ ms: res.ms, usage: res.usage, model: res.model, ok: true });
  } catch (e) {
    setStatus(e.message, true);
    recordDiag({ ms: performance.now() - t0, usage: res?.usage, model: res?.model || settings.model, ok: false, error: e.message });
  } finally {
    schedule(scheduler.done(Date.now()));
  }
}

async function recordDiag(info) {
  const entry = makeEntry(info);
  console.info("hint diag", entry);
  const { diag = [] } = await chrome.storage.local.get("diag");
  await chrome.storage.local.set({ diag: pushEntry(diag, entry) });
}

function renderHint(h) {
  ui.hint.classList.remove("empty");
  ui.qtype.textContent = h.follow_up ? `${h.question_type} · follow-up, same story` : h.question_type;
  ui.question.textContent = h.question_summary;
  ui.stories.innerHTML = "";
  for (const s of h.stories) {
    const el = document.createElement("div");
    el.className = "story";
    const b = document.createElement("b"); b.textContent = s.title;
    const span = document.createElement("span"); span.textContent = s.cue;
    el.append(b, span);
    ui.stories.appendChild(el);
  }
  ui.keywords.innerHTML = "";
  for (const k of h.keywords) {
    const el = document.createElement("span"); el.className = "kw"; el.textContent = k;
    ui.keywords.appendChild(el);
  }
  ui.watch.textContent = h.watch_out;
  ui.hint.classList.add("fresh");
  setTimeout(() => ui.hint.classList.remove("fresh"), 1500);
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
  sessionStart = Date.now();
  transcript = [];
  interim = { interviewer: null, candidate: null };
  lastHint = null;
  scheduler.onCandidateSpeaks(); // clears any pending interviewer text
  clearTimeout(hintTimer);
  renderTranscript();
  ui.hint.classList.add("empty");
  ui.qtype.textContent = ""; ui.question.textContent = "Waiting for a question…";
  ui.stories.innerHTML = ""; ui.keywords.innerHTML = ""; ui.watch.textContent = "";
}

function sttFor(speaker) {
  const stream = new SttStream({
    apiKey: settings.deepgramKey, speaker,
    onInterim, onFinal, onUtteranceEnd,
    onError: (e) => setStatus(e.message, true),
  });
  stream.onStatus = (msg) => setStatus(msg);
  return stream;
}

async function captureTab() {
  if (!settings.deepgramKey) return setStatus("Add a Deepgram key in Settings first.", true);
  try {
    // Chrome requires video:true to offer the "share tab audio" checkbox; we drop the video track.
    const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true, selfBrowserSurface: "exclude" });
    stream.getVideoTracks().forEach((t) => t.stop());
    if (!stream.getAudioTracks().length) {
      return setStatus("No audio in that share. Pick the meeting *tab* and tick 'Share tab audio'.", true);
    }
    beginSessionIfNeeded();
    media.interviewer = stream;
    streams.interviewer = sttFor("interviewer");
    await streams.interviewer.start(stream);
    stream.getAudioTracks()[0].onended = stopAll;
    ui.tab.classList.add("active"); ui.stop.disabled = false;
    setStatus("Call audio live. Now capture your mic.");
  } catch (e) { setStatus(e.message, true); }
}

async function captureMic() {
  const useBuiltin = !settings.deepgramKey;
  if (useBuiltin && !WebSpeechStream.supported()) return setStatus("Add a Deepgram key in Settings first.", true);
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    beginSessionIfNeeded();
    media.candidate = stream;
    if (useBuiltin) {
      streams.candidate = new WebSpeechStream({ speaker: "candidate", onInterim, onFinal, onUtteranceEnd, onError: (e) => setStatus(e.message, true) });
    } else {
      streams.candidate = sttFor("candidate");
    }
    await streams.candidate.start(stream);
    ui.mic.classList.add("active"); ui.stop.disabled = false;
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

async function stopAll() {
  for (const sp of ["interviewer", "candidate"]) {
    streams[sp]?.stop(); streams[sp] = null;
    media[sp]?.getTracks().forEach((t) => t.stop()); media[sp] = null;
  }
  stopTalkClock();
  ui.tab.classList.remove("active"); ui.mic.classList.remove("active"); ui.stop.disabled = true;
  if (transcript.length) {
    const end = Date.now();
    const lines = transcript;
    const session = { start: sessionStart, end, lines, pace: answerStats(lines, end), paceSummary: paceSummary(answerStats(lines, end)) };
    sessionStart = null;
    await appendTranscript(session);
    setStatus("Stopped. Transcript saved. Writing debrief…");
    try {
      session.debrief = await debrief({ apiKey: settings.anthropicKey, model: settings.model, lines, stories: settings.stories });
      await updateLastSession(session);
      setStatus("Debrief ready in Settings → Past sessions.");
    } catch (e) { setStatus(`Transcript saved; debrief failed: ${e.message}`, true); }
  } else setStatus("Stopped.");
  sessionStart = null;
}

// --- Boot ------------------------------------------------------------------

(async () => {
  settings = await loadSettings();
  if (!settings.anthropicKey || !settings.deepgramKey) setStatus("Add your API keys in Settings before starting.", true);
  else if (!settings.stories.length) setStatus("No stories yet. Paste your CV in Settings so hints can point at your own experience.", true);
  chrome.storage.onChanged.addListener(async () => { settings = await loadSettings(); });
  ui.tab.onclick = captureTab;
  ui.mic.onclick = captureMic;
  ui.stop.onclick = stopAll;
})();
