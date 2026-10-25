import { loadSettings, saveSettings } from "./storage.js";
import { extractStories, storyFromAnswer, gapReport, cvTextFromPdf } from "./claude.js";
import { cvTextFromFile } from "./lib/cvFile.js";
import { RESOURCE_KINDS } from "./lib/context.js";
import { buildHintRequest, contextReport } from "./lib/hintRequest.js";
import { countHintTokens } from "./claude.js";
import { exportBank, importBank, mergeStories, normalizeLikely, exportProfile, importProfile } from "./lib/bank.js";
import { STANDARD_QUESTIONS, nextIndex } from "./lib/storyInterview.js";
import { summarize } from "./lib/diag.js";
import { validateSettings } from "./lib/settings.js";
import { addCandidate, addJob, duplicateCandidate, duplicateJob, removeCandidate, removeJob, setActive, candidateLabel, jobLabel } from "./lib/profiles.js";
import { checkDeepgramKey } from "./stt.js";
import { checkAssemblyAiKey } from "./stt-assemblyai.js";
import { checkAnthropicKey } from "./claude.js";

const $ = (id) => document.getElementById(id);
// Chunked so a multi-megabyte PDF does not blow the argument limit of String.fromCharCode.
function bytesToBase64(bytes) {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fields = ["anthropicKey", "deepgramKey", "assemblyaiKey", "sttProvider", "model", "contextTier", "candidateName", "cvText", "jobTitle", "jobDescription"];
let stories = [];
let likely = [];
let resources = [];   // [{kind, text}] extra materials for the coach (candidate's + job's, flattened)
let profiles = null;  // the candidate / job lists; the flat fields above belong to the active pair

// --- Tabs: Start is one screen, Content is everything the coach draws on ---------------
const TABS = ["start", "content"];
function showTab(name) {
  if (!TABS.includes(name)) name = "start";
  for (const t of TABS) { $(`tab-${t}`).classList.toggle("on", t === name); $(`pane-${t}`).hidden = t !== name; }
  try { localStorage.setItem("settingsTab", name); } catch {}
}
function downloadJson(text, filename) {
  const blob = new Blob([text], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = filename; a.click();
  URL.revokeObjectURL(a.href);
}
const slug = (s) => (s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "unnamed";

function renderProfiles() {
  const fill = (sel, map, active, label) => {
    sel.innerHTML = "";
    for (const [id, obj] of Object.entries(map)) { const o = document.createElement("option"); o.value = id; o.textContent = label(obj); sel.appendChild(o); }
    sel.value = active ?? "";
  };
  fill($("candidateSel"), profiles.candidates, profiles.activeCandidate, candidateLabel);
  fill($("jobSel"), profiles.jobs, profiles.activeJob, jobLabel);
  $("cDel").disabled = Object.keys(profiles.candidates).length <= 1;
  $("jDel").disabled = Object.keys(profiles.jobs).length <= 1;
}

// Switching or managing profiles: flush pending edits into the current pair first so nothing
// typed in the last moment is lost, apply the change to a fresh copy, store, reload.
function withProfiles(fn) {
  clearTimeout(autosaveTimer);
  return serial(async () => {
    await saveNow();
    const next = fn((await loadSettings()).profiles);
    if (!next) return;
    await saveSettings({ profiles: next });
    await load();
  });
}

function renderStories() {
  const box = $("stories");
  box.innerHTML = "";
  stories.forEach((s, i) => {
    const card = document.createElement("div");
    card.className = "story-card";
    card.innerHTML = `
      <div class="row">
        <div><label>Title</label><input data-k="title" value=""></div>
        <div><label>Tags</label><input data-k="tags" value=""></div>
      </div>
      <div class="row3">
        <div><label>Situation</label><textarea data-k="situation"></textarea></div>
        <div><label>Action</label><textarea data-k="action"></textarea></div>
        <div><label>Result</label><textarea data-k="result"></textarea></div>
      </div>
      <div class="actions"><button data-del>Remove</button></div>`;
    for (const el of card.querySelectorAll("[data-k]")) {
      el.value = s[el.dataset.k] || "";
      el.oninput = () => { stories[i][el.dataset.k] = el.value; };
    }
    card.querySelector("[data-del]").onclick = () => { stories.splice(i, 1); renderStories(); $("stories").dispatchEvent(new Event("input", { bubbles: true })); };
    box.appendChild(card);
  });
}

function renderResources() {
  const box = $("resources");
  box.innerHTML = "";
  resources.forEach((r, i) => {
    const card = document.createElement("div");
    card.className = "res-card";
    const sel = document.createElement("select");
    for (const k of RESOURCE_KINDS) { const o = document.createElement("option"); o.value = k.id; o.textContent = k.label; sel.appendChild(o); }
    sel.value = RESOURCE_KINDS.some((k) => k.id === r.kind) ? r.kind : "other";
    sel.onchange = () => { resources[i].kind = sel.value; $("resources").dispatchEvent(new Event("input", { bubbles: true })); };
    const ta = document.createElement("textarea");
    ta.placeholder = "Paste the text here";
    ta.value = r.text || "";
    ta.oninput = () => { resources[i].text = ta.value; };
    const del = document.createElement("button");
    del.textContent = "Remove";
    del.onclick = () => { resources.splice(i, 1); renderResources(); $("resources").dispatchEvent(new Event("input", { bubbles: true })); };
    card.append(sel, ta, del);
    box.appendChild(card);
  });
  const n = resources.filter((r) => r.text?.trim()).length;
  $("resSummary").textContent = n ? `${n} material${n === 1 ? "" : "s"} added` : "Add materials";
  if (resources.length) $("resBox").open = true;
}

function renderContext() {
  const rep = contextReport({ stories, cvText: $("cvText").value, jobDescription: $("jobDescription").value, resources, tier: $("contextTier").value });
  const rows = rep.parts.map((p) => p.included
    ? `<tr><td>${esc(p.label)}${p.count != null ? ` <small>(${p.count})</small>` : ""}</td><td>~${p.tokens.toLocaleString()}</td></tr>`
    : `<tr style="color:var(--muted)"><td>${esc(p.label)}${p.count != null ? ` <small>(${p.count})</small>` : ""}</td><td>not sent at this tier</td></tr>`).join("");
  const warn = rep.cacheable ? "" : `<tr><td colspan="2" style="color:var(--warn)">Under the ${rep.cacheMin}-token cache minimum: nothing will cache. Add stories, a CV or materials.</td></tr>`;
  $("ctxTable").innerHTML = `<tr><th>Component</th><th>Tokens (est.)</th></tr>${rows}<tr><th>Total cached prefix</th><th>~${rep.total.toLocaleString()}</th></tr>${warn}`;
  // The Start tab gets one honest line instead of the table.
  const n = stories.filter((s) => s.title?.trim()).length;
  const bits = [`${n} ${n === 1 ? "story" : "stories"}`, $("cvText").value.trim() ? "CV" : "no CV", $("jobDescription").value.trim() ? "job description" : "no job description"];
  $("ctxTotal").textContent = `The coach will see ${bits.join(", ")}: about ${rep.total.toLocaleString()} tokens per hint, cached after the first.`
    + (rep.cacheable ? "" : " That is under the cache minimum, so add stories or a CV on the Content tab.");
  $("ctxTotal").style.color = rep.cacheable && n ? "" : "var(--warn)";
}

function renderLikely() {
  $("likely").innerHTML = "";
  likely = normalizeLikely(likely);
  for (const item of likely) {
    const li = document.createElement("li");
    li.textContent = item.story ? `${item.q}  → ${item.story}` : `⚠ ${item.q}  → no story yet`;
    if (!item.story) li.style.color = "var(--warn)";
    $("likely").appendChild(li);
  }
  const gaps = likely.filter((x) => !x.story).length;
  if (likely.length) $("gapStatus").textContent = gaps ? `${gaps} question(s) without a story. Add one via the guided interview above.` : "Every likely question has a story.";
}

async function renderSessions() {
  const { sessions = [] } = await chrome.storage.local.get("sessions");
  const box = $("sessions");
  box.innerHTML = sessions.length ? "" : "<small>None yet.</small>";
  for (const s of [...sessions].reverse()) {
    const el = document.createElement("div");
    el.className = "session";
    const when = new Date(s.start).toLocaleString();
    const mins = Math.round((s.end - s.start) / 60000);
    const text = s.lines.map((l) => `${l.speaker === "interviewer" ? "Interviewer" : "You"}: ${l.text}`).join("\n");
    const ps = s.paceSummary;
    const paceLine = ps ? ` · ${ps.answers} answers, median ${ps.medianSeconds}s${ps.long ? `, ${ps.long} over 2 min` : ""}${ps.short ? `, ${ps.short} under 20s` : ""}` : "";
    let html = `<b>${esc(when)}</b> · ${mins} min${paceLine}`;
    if (s.debrief) {
      html += `<p><b>Overall.</b> ${esc(s.debrief.overall)}</p><p><b>Practise next:</b> ${esc(s.debrief.top_fix)}</p>`;
      html += `<details><summary>Per question (${s.debrief.answers.length})</summary><ol>` + s.debrief.answers.map((a, i) => {
        const star = ["situation", "task", "action", "result"].map((k) => `<span style="color:${a.star[k] ? "var(--accent)" : "var(--warn)"}">${k[0].toUpperCase()}</span>`).join(" ");
        const secs = s.pace?.[i]?.seconds;
        return `<li><b>${esc(a.question)}</b>${secs != null ? ` <small>(${secs}s)</small>` : ""}<br>STAR: ${star} · story: ${esc(a.story_used || "none")}<br>✓ ${esc(a.went_well)}<br>→ ${esc(a.improve)}</li>`;
      }).join("") + `</ol></details>`;
    } else html += `<p><small>No debrief (add an Anthropic key, or the call failed).</small></p>`;
    html += `<details><summary>Transcript</summary><pre></pre></details>`;
    el.innerHTML = html;
    el.querySelector("pre").textContent = text;
    box.appendChild(el);
  }
}

async function renderDiag() {
  const { diag = [] } = await chrome.storage.local.get("diag");
  const s = summarize(diag);
  $("diagSummary").textContent = s.count
    ? `${s.count} hint calls · median ${s.medianMs} ms · cache hits ${Math.round(s.cacheHitRate * 100)}% (should be high after the first call of a session)`
    : "No hint calls recorded yet.";
  const rows = [...diag].reverse().slice(0, 20).map((e) =>
    `<tr><td>${new Date(e.t).toLocaleTimeString()}</td><td>${e.ok ? e.ms + " ms" : "error"}</td><td>${esc(e.model)}</td><td>${e.input}</td><td>${e.cacheRead}</td><td>${e.output}</td><td>${esc(e.error)}</td></tr>`).join("");
  $("diagTable").innerHTML = rows ? `<tr><th>time</th><th>latency</th><th>model</th><th>input</th><th>cache read</th><th>output</th><th></th></tr>${rows}` : "";
}

let giIndex = 0;
let giSkipped = new Set();

function renderInterview() {
  let i = nextIndex(stories);
  while (i !== -1 && giSkipped.has(STANDARD_QUESTIONS[i].tag)) {
    const rest = STANDARD_QUESTIONS.slice(i + 1).findIndex((q) => !giSkipped.has(q.tag) && !stories.some((s) => s.source === "interview" && s.interviewTag === q.tag));
    i = rest === -1 ? -1 : i + 1 + rest;
  }
  giIndex = i;
  const done = STANDARD_QUESTIONS.filter((q) => stories.some((s) => s.source === "interview" && s.interviewTag === q.tag)).length;
  $("giProgress").textContent = `${done} of ${STANDARD_QUESTIONS.length} answered`;
  const active = i !== -1;
  $("giQuestion").textContent = active ? STANDARD_QUESTIONS[i].q : "All questions answered or skipped. Edit the stories above.";
  $("giAnswer").style.display = active ? "" : "none";
  $("giSave").disabled = !active; $("giSkip").disabled = !active;
}

// Reads the keys back from storage, so the page shows what was actually saved.
async function showKeyStatus(s) {
  s = s || await loadSettings();
  const shown = ["anthropicKey", s.sttProvider === "assemblyai" ? "assemblyaiKey" : "deepgramKey"];
  $("keyStatus").textContent = shown.map((f) => {
    const label = f === "anthropicKey" ? "Anthropic" : f === "deepgramKey" ? "Deepgram" : "AssemblyAI";
    return s[f] ? `${label} key saved (ends …${s[f].slice(-4)})` : `${label} key NOT saved`;
  }).join("  ·  ");
}

// Storage writes from the autosave timer and from a profile switch must never interleave:
// a read-modify-write of `profiles` that started before the switch would write the old
// active pair back and silently undo the switch. One promise chain serialises them all.
let storageChain = Promise.resolve();
function serial(fn) {
  const run = storageChain.then(fn, fn);
  storageChain = run.catch(() => {});
  return run;
}

// Writes the fields that pass validation and returns errors for the rest.
// A field that fails keeps whatever was stored before. Flat content fields land in the
// active candidate and job (storage.js routes them). Always call save(); saveNow() is for
// code already running inside serial().
const save = () => serial(saveNow);
async function saveNow() {
  const form = {};
  for (const f of fields) form[f] = $(f).value;
  form.devMode = $("devMode").checked;
  const { values, errors } = validateSettings(form);
  await saveSettings({ ...values, stories: stories.filter((s) => s.title?.trim()), likelyQuestions: likely, resources: resources.filter((r) => r.text?.trim()) });
  return errors;
}

// The Save button: validate, store, then reload the page from storage so it shows what is really saved.
async function saveAndRefresh() {
  const problems = Object.values(await save());
  await load();
  const st = $("saveStatus");
  st.className = problems.length ? "status error" : "status";
  st.textContent = problems.length
    ? `Not saved: ${problems.join("; ")}. The stored value is shown below.`
    : "Saved. Everything shown is what is stored.";
}

// Every edit is saved as you go, so nothing is lost if Save is never clicked.
// Debounced: one storage write per pause in typing, not one per keystroke.
let autosaveTimer = null;
document.addEventListener("change", (e) => { if (e.target.id === "devMode") document.dispatchEvent(new Event("input")); });
document.addEventListener("input", () => {
  $("saveStatus").className = "status";
  $("saveStatus").textContent = "Saving…";
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(async () => {
    const problems = Object.values(await save());
    const st = $("saveStatus");
    st.className = problems.length ? "status error" : "status";
    st.textContent = problems.length ? `Autosave skipped: ${problems.join("; ")}` : "Autosaved";
    const s = await loadSettings(); // one read: key status, and a new name or title relabels the dropdowns
    showKeyStatus(s);
    renderContext();
    profiles = s.profiles;
    renderProfiles();
  }, 600);
});

async function load() {
  const s = await loadSettings();
  profiles = s.profiles;
  for (const f of fields) $(f).value = s[f] || "";
  $("devMode").checked = !!s.devMode;
  if (![...$("model").options].some((o) => o.value === $("model").value)) $("model").value = "claude-haiku-5-5";
  if (![...$("contextTier").options].some((o) => o.value === $("contextTier").value)) $("contextTier").value = "full";
  stories = s.stories || [];
  resources = s.resources || [];
  likely = s.likelyQuestions || [];
  renderProfiles(); renderStories(); renderLikely(); renderSessions(); renderDiag(); renderInterview(); showKeyStatus(s);
  renderResources(); renderContext();
}

(async () => {
  await load();
  // Tabs: remember the last one; deep links (#mic, #content) open Content.
  for (const t of TABS) $(`tab-${t}`).onclick = () => showTab(t);
  let initialTab = "start";
  try { initialTab = localStorage.getItem("settingsTab") || "start"; } catch {}
  if (location.hash === "#mic" || location.hash === "#content") initialTab = "content";
  showTab(initialTab);
  if (location.hash === "#mic") { $("micBox").open = true; $("mic").scrollIntoView(); }

  // Candidate / job pickers and management
  $("candidateSel").onchange = () => withProfiles((p) => setActive(p, { candidate: $("candidateSel").value }));
  $("jobSel").onchange = () => withProfiles((p) => setActive(p, { job: $("jobSel").value }));
  $("cNew").onclick = () => { const name = prompt("Candidate's first name (you can change it later):", ""); if (name === null) return; withProfiles((p) => addCandidate(p, { name: name.trim() }).profiles); };
  $("jNew").onclick = () => { const title = prompt("Job title, e.g. Senior Accountant, Northwind:", ""); if (title === null) return; withProfiles((p) => addJob(p, { title: title.trim() }).profiles); };
  $("cDup").onclick = () => withProfiles((p) => duplicateCandidate(p, p.activeCandidate).profiles);
  $("jDup").onclick = () => withProfiles((p) => duplicateJob(p, p.activeJob).profiles);
  $("cDel").onclick = () => withProfiles((p) => confirm(`Delete candidate "${candidateLabel(p.candidates[p.activeCandidate])}" with its CV, stories and materials? This cannot be undone.`) ? removeCandidate(p, p.activeCandidate) : null);
  $("jDel").onclick = () => withProfiles((p) => confirm(`Delete job "${jobLabel(p.jobs[p.activeJob])}" with its description and materials? This cannot be undone.`) ? removeJob(p, p.activeJob) : null);

  // Whole-profile export / import
  $("btnExportCand").onclick = async () => { await save(); const p = (await loadSettings()).profiles; const c = p.candidates[p.activeCandidate]; downloadJson(exportProfile("candidate", c), `candidate-${slug(c?.name)}-${new Date().toISOString().slice(0, 10)}.json`); };
  $("btnExportJob").onclick = async () => { await save(); const p = (await loadSettings()).profiles; const j = p.jobs[p.activeJob]; downloadJson(exportProfile("job", j), `job-${slug(jobLabel(j))}-${new Date().toISOString().slice(0, 10)}.json`); };
  $("btnImportProfile").onclick = () => $("profileFile").click();
  $("profileFile").onchange = async () => {
    const file = $("profileFile").files[0]; if (!file) return;
    try {
      const { kind, data } = importProfile(await file.text());
      await withProfiles((p) => (kind === "candidate" ? addCandidate(p, data) : addJob(p, data)).profiles);
      $("profileStatus").textContent = `Imported ${kind} "${kind === "candidate" ? candidateLabel(data) : jobLabel(data)}" and made it active.`;
    } catch (e) { $("profileStatus").textContent = e.message; }
    $("profileFile").value = "";
  };

  $("giSkip").onclick = () => { giSkipped.add(STANDARD_QUESTIONS[giIndex].tag); $("giAnswer").value = ""; renderInterview(); };
  $("giSave").onclick = async () => {
    const st = $("giStatus");
    const answer = $("giAnswer").value.trim();
    if (!$("anthropicKey").value.trim()) { st.textContent = "Add an Anthropic key first (Start tab)."; return; }
    if (answer.split(/\s+/).length < 15) { st.textContent = "Give a bit more detail (a few sentences)."; return; }
    const q = STANDARD_QUESTIONS[giIndex];
    st.textContent = "Tidying into a story card…"; $("giSave").disabled = true;
    try {
      const card = await storyFromAnswer({ apiKey: $("anthropicKey").value.trim(), model: $("model").value, question: q.q, tag: q.tag, answer });
      stories.push({ ...card, source: "interview", interviewTag: q.tag, missing: undefined,
        result: card.missing?.length ? `${card.result}\n\nStill missing: ${card.missing.join("; ")}` : card.result });
      $("giAnswer").value = "";
      renderStories(); renderInterview(); await save(); renderContext();
      st.textContent = `Saved "${card.title}".`;
    } catch (e) { st.textContent = e.message; }
    finally { $("giSave").disabled = false; }
  };
  $("btnClearDiag").onclick = async () => { await chrome.storage.local.set({ diag: [] }); renderDiag(); };

  $("btnMic").onclick = async () => {
    const st = $("micStatus");
    st.textContent = "Requesting…";
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const label = stream.getAudioTracks()[0]?.label || "microphone";
      stream.getTracks().forEach((t) => t.stop());
      st.textContent = `OK: ${label}. Go back to the coach window and click "Capture my mic".`;
    } catch (e) { st.textContent = `${e.name}: ${e.message}`; }
  };

  $("btnGaps").onclick = async () => {
    const st = $("gapStatus");
    if (!$("anthropicKey").value.trim()) { st.textContent = "Add an Anthropic key first (Start tab)."; return; }
    if (!stories.length) { st.textContent = "Add some stories first."; return; }
    st.textContent = "Asking Claude…"; $("btnGaps").disabled = true;
    try { likely = await gapReport({ apiKey: $("anthropicKey").value.trim(), model: $("model").value, jobDescription: $("jobDescription").value, stories }); renderLikely(); await save(); }
    catch (e) { st.textContent = e.message; }
    finally { $("btnGaps").disabled = false; }
  };
  $("btnExport").onclick = () => downloadJson(exportBank(stories, likely), `story-bank-${new Date().toISOString().slice(0, 10)}.json`);
  $("btnImport").onclick = () => $("importFile").click();
  $("importFile").onchange = async () => {
    const file = $("importFile").files[0]; if (!file) return;
    try {
      const { stories: incoming, likelyQuestions } = importBank(await file.text());
      const r = mergeStories(stories, incoming);
      stories = r.stories; if (likelyQuestions.length && !likely.length) likely = likelyQuestions;
      renderStories(); renderLikely(); renderInterview(); await save(); renderContext();
      $("bankStatus").textContent = `Imported ${r.added} stories (${r.skipped} duplicates skipped).`;
    } catch (e) { $("bankStatus").textContent = e.message; }
    $("importFile").value = "";
  };

  $("btnAddStory").onclick = () => { stories.push({ title: "", situation: "", action: "", result: "", tags: "" }); renderStories(); };
  $("btnSave").onclick = saveAndRefresh;
  $("btnTestAnthropic").onclick = async () => {
    const st = $("keyTest");
    st.className = "status"; st.textContent = "Checking with Anthropic…";
    const r = await checkAnthropicKey($("anthropicKey").value.trim());
    st.className = r.ok ? "status" : "status error";
    st.textContent = `Anthropic: ${r.reason}`;
  };
  $("btnTestAssemblyai").onclick = async () => {
    const st = $("keyTest");
    st.className = "status"; st.textContent = "Checking with AssemblyAI…";
    const r = await checkAssemblyAiKey($("assemblyaiKey").value.trim());
    st.className = r.ok ? "status" : "status error";
    st.textContent = `AssemblyAI: ${r.reason}`;
  };
  $("btnTestDeepgram").onclick = async () => {
    const st = $("keyTest");
    st.className = "status"; st.textContent = "Checking with Deepgram…";
    const r = await checkDeepgramKey($("deepgramKey").value.trim());
    st.className = r.ok ? "status" : "status error";
    st.textContent = r.reason;
  };
  // Upload: every format ends up as plain text in the textarea, which then autosaves.
  // Only PDFs need Claude (one short Haiku call); DOCX and text are parsed locally.
  $("btnCvUpload").onclick = () => $("cvFile").click();
  $("cvFile").onchange = async () => {
    const file = $("cvFile").files[0]; if (!file) return;
    const st = $("cvStatus");
    const isPdf = /\.pdf$/i.test(file.name);
    if (isPdf && !$("anthropicKey").value.trim()) { st.textContent = "PDFs are read by Claude: add an Anthropic key first (Start tab), or upload a DOCX/TXT."; return; }
    if (file.size > 8 * 1024 * 1024) { st.textContent = "That file is over 8 MB. Export a smaller PDF or paste the text."; return; }
    st.textContent = isPdf ? "Reading the PDF with Claude… (a few seconds)" : "Reading…";
    $("btnCvUpload").disabled = true;
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const text = await cvTextFromFile({
        name: file.name, bytes,
        pdfToText: isPdf ? (b) => cvTextFromPdf({ apiKey: $("anthropicKey").value.trim(), base64: bytesToBase64(b) }) : null,
      });
      if (!text.trim()) throw new Error("No text found in that file. If it is a scanned PDF, paste the text instead.");
      $("cvText").value = text;
      $("cvText").dispatchEvent(new Event("input", { bubbles: true })); // autosave like a paste
      st.textContent = `Loaded ${file.name}: ${text.length.toLocaleString()} characters. Check it reads right, then draft stories.`;
    } catch (e) { st.textContent = e.message; }
    finally { $("btnCvUpload").disabled = false; $("cvFile").value = ""; }
  };

  $("btnAddRes").onclick = () => { resources.push({ kind: "notes", text: "" }); renderResources(); $("resBox").open = true; };
  $("btnResUpload").onclick = () => $("resFile").click();
  $("resFile").onchange = async () => {
    const file = $("resFile").files[0]; if (!file) return;
    const st = $("resStatus");
    const isPdf = /\.pdf$/i.test(file.name);
    if (isPdf && !$("anthropicKey").value.trim()) { st.textContent = "PDFs are read by Claude: add an Anthropic key first (Start tab)."; return; }
    st.textContent = isPdf ? "Reading the PDF with Claude…" : "Reading…";
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const text = await cvTextFromFile({ name: file.name, bytes,
        pdfToText: isPdf ? (b) => cvTextFromPdf({ apiKey: $("anthropicKey").value.trim(), base64: bytesToBase64(b) }) : null });
      if (!text.trim()) throw new Error("No text found in that file.");
      const guess = /cover|motivation|letter/i.test(file.name) ? "cover_letter" : /linkedin/i.test(file.name) ? "linkedin" : "other";
      resources.push({ kind: guess, text });
      renderResources();
      $("resources").dispatchEvent(new Event("input", { bubbles: true }));
      st.textContent = `Added ${file.name}. Pick what it is in the dropdown.`;
    } catch (e) { st.textContent = e.message; }
    finally { $("resFile").value = ""; }
  };
  $("btnCountCtx").onclick = async () => {
    const st = $("ctxStatus");
    if (!$("anthropicKey").value.trim()) { st.textContent = "Add an Anthropic key first (Start tab)."; return; }
    st.textContent = "Counting…";
    try {
      const body = buildHintRequest({ model: $("model").value, transcript: [], stories, jobDescription: $("jobDescription").value, cvText: $("cvText").value, resources, tier: $("contextTier").value });
      const n = await countHintTokens({ apiKey: $("anthropicKey").value.trim(), body });
      st.textContent = `Exact: ${n.toLocaleString()} input tokens for a hint request (prefix plus an empty transcript).`;
    } catch (e) { st.textContent = e.message; }
  };

  $("btnExtract").onclick = async () => {
    const st = $("extractStatus");
    if (!$("anthropicKey").value.trim()) { st.textContent = "Add an Anthropic key first (Start tab)."; return; }
    if (!$("cvText").value.trim()) { st.textContent = "Upload or paste a CV first."; return; }
    st.textContent = "Asking Claude… (10-30 s)";
    $("btnExtract").disabled = true;
    try {
      const out = await extractStories({
        apiKey: $("anthropicKey").value.trim(), model: $("model").value.trim(),
        cvText: $("cvText").value, jobDescription: $("jobDescription").value,
      });
      stories = [...stories, ...out.stories.map((s) => ({ ...s, source: "cv" }))];
      likely = normalizeLikely(out.likely_questions);
      renderStories(); renderLikely(); renderInterview(); await save(); renderContext();
      st.textContent = `Drafted ${out.stories.length} stories and saved. Edit them until they sound like you.`;
    } catch (e) { st.textContent = e.message; }
    finally { $("btnExtract").disabled = false; }
  };
})();
