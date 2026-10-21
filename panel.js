import { loadSettings, appendTranscript } from "./storage.js";
import { SttStream } from "./stt.js";
import { getHint } from "./claude.js";
import { mergeFinal } from "./lib/transcript.js";
import { shouldAskForHint } from "./lib/question.js";
import { validateHint } from "./lib/hintSchema.js";

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
let pendingQuestion = "";            // interviewer speech since last hint
let hintInFlight = false;
let hintTimer = null;
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
  if (speaker === "candidate" && !talkStart) startTalkClock();
  renderTranscript();
}

function onFinal({ speaker, text, speechFinal }) {
  interim[speaker] = null;
  mergeFinal(transcript, { speaker, text });
  renderTranscript();

  if (speaker === "interviewer") {
    stopTalkClock();
    const decision = shouldAskForHint({ text, speechFinal, pendingText: pendingQuestion });
    pendingQuestion += " " + text;
    clearTimeout(hintTimer);
    if (!decision.ask) return;
    if (decision.delayMs === 0) requestHint();
    else hintTimer = setTimeout(requestHint, decision.delayMs);
  }
}

function onUtteranceEnd({ speaker }) {
  if (speaker === "interviewer" && pendingQuestion.trim()) requestHint();
}

// --- Hints -----------------------------------------------------------------

async function requestHint() {
  clearTimeout(hintTimer);
  const q = pendingQuestion.trim();
  if (!q || hintInFlight) return;
  hintInFlight = true;
  pendingQuestion = "";
  const t0 = performance.now();
  try {
    const raw = await getHint({
      apiKey: settings.anthropicKey, model: settings.model, transcript,
      stories: settings.stories, jobDescription: settings.jobDescription, cvText: settings.cvText,
    });
    const { ok, errors, hint } = validateHint(raw, settings.stories.map((s) => s.title));
    if (errors.length) console.warn("hint validator:", errors);
    if (!ok) throw new Error("Hint rejected by validator; see console.");
    if (hint.is_question) renderHint(hint);
    setStatus(`Hint in ${Math.round(performance.now() - t0)} ms`);
  } catch (e) {
    setStatus(e.message, true);
  } finally {
    hintInFlight = false;
    // If more interviewer speech arrived meanwhile, process it.
    if (pendingQuestion.trim()) hintTimer = setTimeout(requestHint, 300);
  }
}

function renderHint(h) {
  ui.hint.classList.remove("empty");
  ui.qtype.textContent = h.question_type;
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

function sttFor(speaker) {
  return new SttStream({
    apiKey: settings.deepgramKey, speaker,
    onInterim, onFinal, onUtteranceEnd,
    onError: (e) => setStatus(e.message, true),
  });
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
    media.interviewer = stream;
    streams.interviewer = sttFor("interviewer");
    await streams.interviewer.start(stream);
    stream.getAudioTracks()[0].onended = stopAll;
    ui.tab.classList.add("active"); ui.stop.disabled = false;
    sessionStart ??= Date.now();
    setStatus("Call audio live. Now capture your mic.");
  } catch (e) { setStatus(e.message, true); }
}

async function captureMic() {
  if (!settings.deepgramKey) return setStatus("Add a Deepgram key in Settings first.", true);
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    media.candidate = stream;
    streams.candidate = sttFor("candidate");
    await streams.candidate.start(stream);
    ui.mic.classList.add("active"); ui.stop.disabled = false;
    sessionStart ??= Date.now();
    setStatus("Mic live. Good luck.");
  } catch (e) { setStatus(e.message, true); }
}

async function stopAll() {
  for (const sp of ["interviewer", "candidate"]) {
    streams[sp]?.stop(); streams[sp] = null;
    media[sp]?.getTracks().forEach((t) => t.stop()); media[sp] = null;
  }
  stopTalkClock();
  ui.tab.classList.remove("active"); ui.mic.classList.remove("active"); ui.stop.disabled = true;
  if (transcript.length) {
    await appendTranscript({ start: sessionStart, end: Date.now(), lines: transcript });
    setStatus("Stopped. Transcript saved locally (see Settings → Past sessions).");
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
