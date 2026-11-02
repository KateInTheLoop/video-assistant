import { loadSettings, saveSettings } from "./storage.js";
import { extractStories, storyFromAnswer, gapReport, cvTextFromPdf } from "./claude.js";
import { cvTextFromFile } from "./lib/cvFile.js";
import { RESOURCE_KINDS, MATERIAL_PRIORITIES, materialPriority, materialOwner, rankedMaterials, materialPlan, normalizeMaterial, applyTier } from "./lib/context.js";
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
import { preparedResume } from "./lib/preparedResume.js";

const $ = (id) => document.getElementById(id);
const statusActivities = new WeakMap();

// Indeterminate activity lasts through the request and its save, without invented progress.
// Reference counting also keeps a shared status busy until every pending operation settles.
function beginStatusActivity(status, message) {
  statusActivities.set(status, (statusActivities.get(status) || 0) + 1);
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  status.setAttribute("aria-atomic", "true");
  status.setAttribute("aria-busy", "true");
  status.textContent = message;
  let finished = false;
  return () => {
    if (finished) return;
    finished = true;
    const remaining = Math.max(0, (statusActivities.get(status) || 1) - 1);
    statusActivities.set(status, remaining);
    status.setAttribute("aria-busy", String(remaining > 0));
  };
}

let keyCheckBusy = false;
async function checkKeyStatus(provider, check, keyField) {
  if (keyCheckBusy) return;
  keyCheckBusy = true;
  const buttons = ["btnTestAnthropic", "btnTestAssemblyai", "btnTestDeepgram"].map($);
  for (const button of buttons) button.disabled = true;
  const st = $("keyTest"); st.className = "status";
  const finish = beginStatusActivity(st, `Checking with ${provider}…`);
  try {
    const result = await check($(keyField).value.trim());
    st.className = result.ok ? "status" : "status error";
    st.textContent = `${provider}: ${result.reason}`;
  } catch (e) { st.className = "status error"; st.textContent = e.message; }
  finally {
    finish(); keyCheckBusy = false;
    for (const button of buttons) button.disabled = false;
  }
}
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
let profileTasks = 0;
let profileChanges = 0;
const PROFILE_CONTROLS = ["candidateSel", "jobSel", "cNew", "cDup", "cDel", "jNew", "jDup", "jDel", "btnImportProfile", "btnReloadSettings"];

function renderProfileLock() {
  const busy = profileTasks > 0 || profileChanges > 0;
  for (const id of PROFILE_CONTROLS) $(id).disabled = busy;
  $("cDel").disabled ||= Object.keys(profiles.candidates).length <= 1;
  $("jDel").disabled ||= Object.keys(profiles.jobs).length <= 1;
  $("profileBusy").textContent = profileTasks ? "Preparing content. Candidate and job selection will unlock when it is saved." : "";
  $("profileBusy").setAttribute("aria-busy", String(profileTasks > 0));
}

// Lock synchronously, before any file read or API request can yield. Hold the lock through
// the final save, including debounced upload saves, and always release it after failures.
async function profileTask(work) {
  if (profileChanges) {
    $("profileBusy").textContent = "Wait for the profile switch to finish, then try again.";
    return;
  }
  profileTasks++;
  renderProfileLock();
  try { return await work(); }
  finally { profileTasks--; renderProfileLock(); }
}

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
  renderProfileLock();
}

// Switching or managing profiles: flush pending edits into the current pair first so nothing
// typed in the last moment is lost, apply the change to a fresh copy, store, reload.
function withProfiles(fn) {
  if (profileTasks) return Promise.resolve(false);
  profileChanges++;
  renderProfileLock();
  clearTimeout(autosaveTimer);
  return serial(async () => {
    await saveNow();
    const current = (await loadSettings()).profiles;
    if ((current.revision || 0) !== (profiles.revision || 0)) throw new Error("Profiles changed in another window. Reload saved settings.");
    const next = fn({ ...current, activeCandidate: profiles.activeCandidate, activeJob: profiles.activeJob });
    if (!next) return;
    await saveSettings({ profiles: next }, { expectedRevision: current.revision || 0 });
    giSkipped = new Set();
    $("giAnswer").value = "";
    await load();
    return true;
  }).catch((e) => { $("profileStatus").textContent = e.message; $("saveStatus").textContent = e.message; return false; })
    .finally(() => { profileChanges--; renderProfileLock(); });
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

const resourceStatuses = new Map();
const resourceViews = new Map();
let resumePreviewKey = "";

function resourceScope(resource) {
  return materialOwner(resource) === "job" ? `This job: ${jobLabel(profiles?.jobs?.[profiles.activeJob])}`
    : `${candidateLabel(profiles?.candidates?.[profiles.activeCandidate])} — all jobs`;
}

function renderGuidanceReadiness(plan, selected) {
  const entries = new Map(plan.entries.map(entry => [entry.resource, entry]));
  const notes = resources.filter(r => r.kind === "notes" && r.text?.trim() && materialPriority(r) > 0);
  const full = notes.filter(r => entries.get(r)?.status === "included").length;
  const partial = notes.filter(r => entries.get(r)?.status === "truncated").length;
  const omitted = notes.length - full - partial;
  const counts = [full && `${full} fully included`, partial && `${partial} partly included`, omitted && `${omitted} not included`].filter(Boolean);
  $("guidanceStatus").textContent = notes.length ? `Interview notes in these settings: ${counts.join(" · ")}.`
    : resources.some(r => r.kind === "notes" && r.text?.trim()) ? "Interview notes are Off. Enable a note to guide coaching."
    : "No interview notes yet. Add likely topics and skills to emphasize.";
  $("guidanceContext").textContent = `Preparing ${candidateLabel(profiles?.candidates?.[profiles.activeCandidate])} for ${jobLabel(profiles?.jobs?.[profiles.activeJob])}`;
  $("resumeReadyStatus").textContent = selected ? `Resume answer selected — ${resourceScope(selected)}.`
    : resources.some(r => r.kind === "resume_summary" && r.text?.trim()) ? "Prepared resume answers are Off. Enable one to use it during a walkthrough."
    : "No prepared resume answer yet. Add the wording you want to use.";
  $("resumeReadyStatus").dataset.state = selected ? "selected" : "empty";
  const key = selected ? `${profiles?.activeCandidate}:${profiles?.activeJob}:${resources.indexOf(selected)}:${materialOwner(selected)}` : "";
  if (key !== resumePreviewKey) $("resumePreview").open = false;
  resumePreviewKey = key;
  $("resumePreview").hidden = !selected;
  $("resumePreviewText").textContent = selected?.text || "";
  $("resumePreviewScope").textContent = selected ? `${resourceScope(selected)} · Shown word for word for resume questions` : "";
}

function renderMaterialStatus() {
  const eligible = applyTier({ resources }, $("contextTier").value).resources;
  const plan = materialPlan(eligible), statuses = new Map(plan.entries.map(e => [e.resource, e]));
  const selected = preparedResume(eligible);
  for (const [resource, label] of resourceStatuses) {
    const entry = statuses.get(resource);
    const state = !resource.text?.trim() ? "empty" : !materialPriority(resource) ? "off" : !entry ? "excluded" : entry.status;
    const view = resourceViews.get(resource);
    if (view) {
      view.card.dataset.state = resource === selected ? "selected" : state;
      view.badge.textContent = resource === selected ? "Selected for resume questions"
        : state === "empty" ? "Empty draft" : state === "off" ? "Off"
        : state === "superseded" ? "Alternate answer" : state === "included" ? "Included"
        : state === "truncated" ? "Partly included" : "Not included";
    }
    label.textContent = !resource.text?.trim() ? "Empty — add guidance or source text"
      : !materialPriority(resource) ? "Off — excluded from AI context"
      : !entry ? "Excluded by context tier — choose Everything to include this material"
      : entry.status === "superseded" ? "Another prepared resume answer is selected — change priorities or set the other answer to Off"
      : resource.kind === "resume_summary" && entry.status === "truncated" ? `AI receives an excerpt (${entry.sentChars.toLocaleString()} of ${resource.text.length.toLocaleString()} characters). The coach displays your full saved answer for a resume walkthrough.`
      : resource.kind === "resume_summary" && entry.status === "omitted" ? "AI context budget omits this answer. The coach still displays your full saved answer for a resume walkthrough."
      : entry.status === "truncated" ? `Partially included (${entry.sentChars.toLocaleString()} characters) — shorten this material or lower other priorities`
      : entry.status === "omitted" ? "Not included — other materials fill the context budget"
      : "Included in AI context";
  }
  const active = eligible.filter(r => r.text?.trim()).length;
  const included = plan.entries.filter(e => ["included", "truncated"].includes(e.status)).length;
  $("resBudget").textContent = `${included} of ${active} enabled material${active === 1 ? "" : "s"} included in AI context. Coach notes and resume summaries are available in every context tier unless set to Off. AI context follows priority order; resume walkthroughs display your full saved answer locally.`
    + (plan.truncated ? " Some material is shortened or omitted; see the status on each card." : "");
  renderGuidanceReadiness(plan, selected);
}

function renderResources() {
  const box = $("resources");
  box.innerHTML = "";
  resourceStatuses.clear(); resourceViews.clear();
  rankedMaterials(resources).forEach(({ resource: r, index: i }, rank) => {
    const card = document.createElement("div");
    card.className = "res-card";
    card.dataset.priority = String(materialPriority(r));
    card.dataset.kind = r.kind;
    const heading = document.createElement("div"); heading.className = "resource-heading";
    const title = document.createElement("h3"), badge = document.createElement("span"); badge.className = "resource-badge";
    title.textContent = `${rank + 1}. ${r.kind === "resume_summary" ? "Prepared resume answer" : RESOURCE_KINDS.find(k => k.id === r.kind)?.label || "Other material"}`;
    heading.append(title, badge);
    const purpose = document.createElement("p"); purpose.className = "resource-purpose";
    purpose.textContent = r.kind === "notes" ? "Guide the topics, skills and examples Claude should emphasize."
      : r.kind === "resume_summary" ? "Your exact wording for resume walkthroughs and introductions."
      : "Supporting context for coaching when Everything is selected.";
    const controls = document.createElement("div"); controls.className = "res-controls";
    const kindLabel = document.createElement("label"); kindLabel.textContent = "Material type"; kindLabel.className = "res-field";
    const sel = document.createElement("select"); sel.className = "resource-type"; sel.setAttribute("aria-label", "Material type");
    for (const k of RESOURCE_KINDS) { const o = document.createElement("option"); o.value = k.id; o.textContent = k.label; sel.appendChild(o); }
    sel.value = RESOURCE_KINDS.some((k) => k.id === r.kind) ? r.kind : "other";
    sel.onchange = () => { resources[i].kind = sel.value; renderResources(); resourceViews.get(r)?.type.focus?.(); $("resources").dispatchEvent(new Event("input", { bubbles: true })); };
    kindLabel.appendChild(sel);
    const scopeLabel = document.createElement("label"); scopeLabel.textContent = "Applies to"; scopeLabel.className = "res-field";
    const scope = document.createElement("select"); scope.setAttribute("aria-label", "Applies to");
    for (const [value, text] of [["job", "This job"], ["candidate", "Candidate — all jobs"]]) {
      const option = document.createElement("option"); option.value = value; option.textContent = text; scope.appendChild(option);
    }
    scope.value = materialOwner(r);
    scope.onchange = () => { r.scope = scope.value; renderResources(); resourceViews.get(r)?.scope.focus?.(); $("resources").dispatchEvent(new Event("input", { bubbles: true })); };
    scopeLabel.appendChild(scope);
    const priorityLabel = document.createElement("label"), priorityText = document.createElement("span");
    priorityLabel.className = "res-field";
    priorityText.textContent = `Priority ${materialPriority(r)}/5 — ${MATERIAL_PRIORITIES[materialPriority(r)]}`;
    const priority = document.createElement("input"); priority.type = "range"; priority.min = "0"; priority.max = "5"; priority.step = "1";
    priority.value = String(materialPriority(r)); priority.setAttribute("aria-label", "Material priority");
    priority.oninput = () => {
      r.priority = Number(priority.value);
      card.dataset.priority = String(r.priority);
      priorityText.textContent = `Priority ${r.priority}/5 — ${MATERIAL_PRIORITIES[r.priority]}`;
      priority.setAttribute("aria-valuetext", MATERIAL_PRIORITIES[r.priority]); renderMaterialStatus();
    };
    priority.onchange = () => { renderResources(); resourceViews.get(r)?.priority.focus?.(); $("resources").dispatchEvent(new Event("input", { bubbles: true })); };
    priority.setAttribute("aria-valuetext", MATERIAL_PRIORITIES[materialPriority(r)]);
    priorityLabel.append(priorityText, priority); controls.append(kindLabel, scopeLabel, priorityLabel);
    const ta = document.createElement("textarea");
    ta.className = "resource-text";
    ta.setAttribute("aria-label", r.kind === "resume_summary" ? "Your prepared resume answer" : r.kind === "notes" ? "Your interview notes" : "Material source text");
    ta.placeholder = r.kind === "resume_summary" ? "Paste your exact prepared answer to ‘Walk me through your resume’ in your own words, with the sequence and emphasis you want to use…"
      : r.kind === "notes" ? "Expected topics, technical domains, skills to emphasize, and links between this job and your experience…" : "Paste the source text here";
    ta.value = r.text || "";
    ta.oninput = () => { resources[i].text = ta.value; renderMaterialStatus(); };
    const content = document.createElement("div"), status = document.createElement("small"); status.className = "resource-status";
    if (r.kind === "resume_summary") {
      const help = document.createElement("small");
      help.textContent = "The selected summary appears first exactly as written for a resume walkthrough. Highest priority wins; This job wins ties. Keep This job for a tailored answer; choose Candidate — all jobs for a general summary.";
      content.appendChild(help);
    }
    resourceStatuses.set(r, status); content.append(ta, status);
    resourceViews.set(r, { card, badge, editor: ta, type: sel, scope, priority });
    const del = document.createElement("button");
    del.textContent = "Remove";
    del.onclick = () => { resources.splice(i, 1); renderResources(); (resourceViews.values().next().value?.editor || $("btnAddRes")).focus?.(); $("resources").dispatchEvent(new Event("input", { bubbles: true })); };
    card.append(heading, purpose, controls, content, del);
    box.appendChild(card);
  });
  const n = resources.filter((r) => r.text?.trim()).length;
  $("resSummary").textContent = n ? `${n} material${n === 1 ? "" : "s"} added` : "Add notes or a prepared answer above to guide your next interview.";
  renderMaterialStatus();
}

function addGuidance(kind) {
  const resource = normalizeMaterial({ kind, text: "" }, "job");
  resources.push(resource); renderResources();
  resourceViews.get(resource)?.editor.focus?.();
}

let countedContext = null;
function contextRequest() {
  return buildHintRequest({ model: $("model").value, transcript: [], stories, jobDescription: $("jobDescription").value,
    cvText: $("cvText").value, resources, tier: $("contextTier").value });
}

function invalidateContextCount() {
  if (countedContext !== null && countedContext !== JSON.stringify(contextRequest())) {
    $("ctxStatus").textContent = "Context changed. Count again for updated input tokens.";
    countedContext = null;
  }
}

function renderContext() {
  invalidateContextCount();
  renderMaterialStatus();
  const rep = contextReport({ stories, cvText: $("cvText").value, jobDescription: $("jobDescription").value, resources, tier: $("contextTier").value });
  const rows = rep.parts.map((p) => p.included
    ? `<tr><td>${esc(p.label)}${p.count != null ? ` <small>(${p.count})</small>` : ""}</td><td>~${p.tokens.toLocaleString()}</td></tr>`
    : `<tr style="color:var(--muted)"><td>${esc(p.label)}${p.count != null ? ` <small>(${p.count})</small>` : ""}</td><td>not sent at this tier</td></tr>`).join("");
  const warn = rep.cacheable ? "" : `<tr><td colspan="2" style="color:var(--warn)">Below the estimated ${rep.cacheMin}-token cache minimum; caching may not activate. Add context only when it helps the interview.</td></tr>`;
  $("ctxTable").innerHTML = `<tr><th>Component</th><th>Tokens (est.)</th></tr>${rows}<tr><th>Estimated reusable context</th><th>~${rep.total.toLocaleString()}</th></tr>${warn}`;
  // The Start tab gets one honest line instead of the table.
  const n = stories.filter((s) => s.title?.trim()).length;
  const bits = [`${n} ${n === 1 ? "story" : "stories"}`, $("cvText").value.trim() ? "CV" : "no CV", $("jobDescription").value.trim() ? "job description" : "no job description"];
  $("ctxTotal").textContent = `The coach will see ${bits.join(", ")}: about ${rep.total.toLocaleString()} tokens of reusable context, with one-hour caching requested. Live transcript and answer tokens are additional.`
    + (rep.cacheable ? "" : " This may be below the cache minimum.");
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
    const context = [s.candidateName, s.jobTitle].filter(Boolean).map(esc).join(" · ");
    if (context) html += `<p>${context}</p>`;
    if (s.captions?.samples) html += `<p><small>Deepgram interim backlog: median ${esc(s.captions.medianBacklogMs)} ms, p95 ${esc(s.captions.p95BacklogMs)} ms; maximum caption update ${esc(s.captions.maxRenderMs)} ms. Audio-cursor estimate, not total speech-to-screen latency.</small></p>`;
    if (s.recovered) html += "<p><small>Recovered after an interrupted call. No automatic debrief was uploaded.</small></p>";
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
  const target = { candidate: profiles.activeCandidate, job: profiles.activeJob };
  const boundTarget = target.candidate && target.job ? target : undefined;
  const saved = await saveSettings({ ...values, stories: stories.filter((s) => s.title?.trim()), likelyQuestions: likely, resources: resources.filter((r) => r.text?.trim()) },
    { target: boundTarget, expectedRevision: profiles.revision || 0 });
  if (saved) profiles = boundTarget ? { ...saved, activeCandidate: target.candidate, activeJob: target.job } : saved;
  return errors;
}

// The Save button: validate, store, then reload the page from storage so it shows what is really saved.
async function saveAndRefresh() {
  try {
    const problems = Object.values(await save());
    await load();
    const st = $("saveStatus");
    st.className = problems.length ? "status error" : "status";
    st.textContent = problems.length
      ? `Not saved: ${problems.join("; ")}. The stored value is shown below.`
      : "Saved. Everything shown is what is stored.";
  } catch (e) { $("saveStatus").className = "status error"; $("saveStatus").textContent = e.message; }
}

// Every edit is saved as you go, so nothing is lost if Save is never clicked.
// Debounced: one storage write per pause in typing, not one per keystroke.
let autosaveTimer = null;
document.addEventListener("change", (e) => { if (e.target.id === "devMode") document.dispatchEvent(new Event("input")); });
document.addEventListener("input", () => {
  invalidateContextCount();
  $("saveStatus").className = "status";
  $("saveStatus").textContent = "Saving…";
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(async () => {
    try {
      const problems = Object.values(await save());
      const st = $("saveStatus");
      st.className = problems.length ? "status error" : "status";
      st.textContent = problems.length ? `Autosave skipped: ${problems.join("; ")}` : "Autosaved";
      const s = await loadSettings(); // one read: key status, and a new name or title relabels the dropdowns
      showKeyStatus(s);
      renderContext();
      // Relabel this window's pair without adopting a selection from another window.
      renderProfiles();
    } catch (e) { $("saveStatus").className = "status error"; $("saveStatus").textContent = e.message; }
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
  $("candidateSel").onchange = () => { const candidate = $("candidateSel").value; return withProfiles((p) => setActive(p, { candidate })); };
  $("jobSel").onchange = () => { const job = $("jobSel").value; return withProfiles((p) => setActive(p, { job })); };
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
      if (await withProfiles((p) => (kind === "candidate" ? addCandidate(p, data) : addJob(p, data)).profiles) === false) return;
      $("profileStatus").textContent = `Imported ${kind} "${kind === "candidate" ? candidateLabel(data) : jobLabel(data)}" and made it active.`;
    } catch (e) { $("profileStatus").textContent = e.message; }
    $("profileFile").value = "";
  };

  $("giSkip").onclick = () => { giSkipped.add(STANDARD_QUESTIONS[giIndex].tag); $("giAnswer").value = ""; renderInterview(); };
  $("giSave").onclick = () => profileTask(async () => {
    const st = $("giStatus");
    const answer = $("giAnswer").value.trim();
    if (!$("anthropicKey").value.trim()) { st.textContent = "Add an Anthropic key first (Start tab)."; return; }
    if (answer.split(/\s+/).length < 15) { st.textContent = "Give a bit more detail (a few sentences)."; return; }
    const q = STANDARD_QUESTIONS[giIndex];
    const finish = beginStatusActivity(st, "Tidying into a story card…"); $("giSave").disabled = true;
    try {
      const card = await storyFromAnswer({ apiKey: $("anthropicKey").value.trim(), model: $("model").value, question: q.q, tag: q.tag, answer, resources: applyTier({ resources }, $("contextTier").value).resources });
      stories.push({ ...card, source: "interview", interviewTag: q.tag, missing: undefined,
        result: card.missing?.length ? `${card.result}\n\nStill missing: ${card.missing.join("; ")}` : card.result });
      $("giAnswer").value = "";
      renderStories(); renderInterview(); await save(); renderContext();
      st.textContent = `Saved "${card.title}".`;
    } catch (e) { st.textContent = e.message; }
    finally { finish(); $("giSave").disabled = false; }
  });
  $("btnClearDiag").onclick = async () => { await chrome.storage.local.set({ diag: [] }); renderDiag(); };

  $("btnMic").onclick = async () => {
    const st = $("micStatus");
    const finish = beginStatusActivity(st, "Requesting microphone access…"); $("btnMic").disabled = true;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const label = stream.getAudioTracks()[0]?.label || "microphone";
      stream.getTracks().forEach((t) => t.stop());
      st.textContent = `OK: ${label}. Go back to the coach window and click "Capture my mic".`;
    } catch (e) { st.textContent = `${e.name}: ${e.message}`; }
    finally { finish(); $("btnMic").disabled = false; }
  };

  $("btnGaps").onclick = () => profileTask(async () => {
    const st = $("gapStatus");
    if (!$("anthropicKey").value.trim()) { st.textContent = "Add an Anthropic key first (Start tab)."; return; }
    if (!stories.length) { st.textContent = "Add some stories first."; return; }
    const finish = beginStatusActivity(st, "Finding likely questions with Claude…"); $("btnGaps").disabled = true;
    try { likely = await gapReport({ apiKey: $("anthropicKey").value.trim(), model: $("model").value, jobDescription: $("jobDescription").value, stories, resources: applyTier({ resources }, $("contextTier").value).resources }); renderLikely(); await save(); }
    catch (e) { st.textContent = e.message; }
    finally { finish(); $("btnGaps").disabled = false; }
  });
  $("btnExport").onclick = () => downloadJson(exportBank(stories, likely), `story-bank-${new Date().toISOString().slice(0, 10)}.json`);
  $("btnImport").onclick = () => $("importFile").click();
  $("importFile").onchange = () => profileTask(async () => {
    const file = $("importFile").files[0]; if (!file) return;
    try {
      const { stories: incoming, likelyQuestions } = importBank(await file.text());
      const r = mergeStories(stories, incoming);
      stories = r.stories; if (likelyQuestions.length && !likely.length) likely = likelyQuestions;
      renderStories(); renderLikely(); renderInterview(); await save(); renderContext();
      $("bankStatus").textContent = `Imported ${r.added} stories (${r.skipped} duplicates skipped).`;
    } catch (e) { $("bankStatus").textContent = e.message; }
    $("importFile").value = "";
  });

  $("btnAddStory").onclick = () => { stories.push({ title: "", situation: "", action: "", result: "", tags: "" }); renderStories(); };
  $("btnSave").onclick = saveAndRefresh;
  $("btnReloadSettings").onclick = async () => {
    if (profileTasks || profileChanges) return;
    clearTimeout(autosaveTimer);
    giSkipped = new Set(); $("giAnswer").value = "";
    await serial(load);
    $("saveStatus").textContent = "Saved settings reloaded.";
  };
  $("btnTestAnthropic").onclick = () => checkKeyStatus("Anthropic", checkAnthropicKey, "anthropicKey");
  $("btnTestAssemblyai").onclick = () => checkKeyStatus("AssemblyAI", checkAssemblyAiKey, "assemblyaiKey");
  $("btnTestDeepgram").onclick = () => checkKeyStatus("Deepgram", checkDeepgramKey, "deepgramKey");
  // Upload: every format ends up as plain text in the textarea, which then autosaves.
  // Only PDFs need Claude (one short Haiku call); DOCX and text are parsed locally.
  $("btnCvUpload").onclick = () => $("cvFile").click();
  $("cvFile").onchange = () => profileTask(async () => {
    const file = $("cvFile").files[0]; if (!file) return;
    const st = $("cvStatus");
    const isPdf = /\.pdf$/i.test(file.name);
    if (isPdf && !$("anthropicKey").value.trim()) { st.textContent = "PDFs are read by Claude: add an Anthropic key first (Start tab), or upload a DOCX/TXT."; return; }
    if (file.size > 8 * 1024 * 1024) { st.textContent = "That file is over 8 MB. Export a smaller PDF or paste the text."; return; }
    const finish = beginStatusActivity(st, isPdf ? "Reading the PDF with Claude…" : "Reading the CV…");
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
      clearTimeout(autosaveTimer);
      await save();
      st.textContent = `Loaded ${file.name}: ${text.length.toLocaleString()} characters. Check it reads right, then draft stories.`;
    } catch (e) { st.textContent = e.message; }
    finally { finish(); $("btnCvUpload").disabled = false; $("cvFile").value = ""; }
  });

  $("btnReviewGuidance").onclick = () => { showTab("content"); $("guidanceHeading").scrollIntoView({ block: "start" }); $("guidanceHeading").focus?.({ preventScroll: true }); };
  $("btnAddRes").onclick = () => addGuidance("notes");
  $("btnAddResumeSummary").onclick = () => addGuidance("resume_summary");
  $("btnResUpload").onclick = () => $("resFile").click();
  $("resFile").onchange = () => profileTask(async () => {
    const file = $("resFile").files[0]; if (!file) return;
    const st = $("resStatus");
    const isPdf = /\.pdf$/i.test(file.name);
    if (isPdf && !$("anthropicKey").value.trim()) { st.textContent = "PDFs are read by Claude: add an Anthropic key first (Start tab)."; return; }
    const finish = beginStatusActivity(st, isPdf ? "Reading the PDF with Claude…" : "Reading the material…");
    $("btnResUpload").disabled = true;
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const text = await cvTextFromFile({ name: file.name, bytes,
        pdfToText: isPdf ? (b) => cvTextFromPdf({ apiKey: $("anthropicKey").value.trim(), base64: bytesToBase64(b) }) : null });
      if (!text.trim()) throw new Error("No text found in that file.");
      const guess = /notes|interview|briefing/i.test(file.name) ? "notes" : /cover|motivation|letter/i.test(file.name) ? "cover_letter" : /linkedin/i.test(file.name) ? "linkedin" : "other";
      resources.push(normalizeMaterial({ kind: guess, text }, guess === "notes" ? "job" : undefined));
      renderResources();
      $("resources").dispatchEvent(new Event("input", { bubbles: true }));
      clearTimeout(autosaveTimer);
      await save();
      st.textContent = `Added ${file.name}. Pick what it is in the dropdown.`;
    } catch (e) { st.textContent = e.message; }
    finally { finish(); $("btnResUpload").disabled = false; $("resFile").value = ""; }
  });
  $("btnCountCtx").onclick = async () => {
    if ($("btnCountCtx").disabled) return;
    const st = $("ctxStatus");
    if (!$("anthropicKey").value.trim()) { st.textContent = "Add an Anthropic key first (Start tab)."; return; }
    const finish = beginStatusActivity(st, "Counting context with Claude…"); $("btnCountCtx").disabled = true;
    let key;
    try {
      const body = contextRequest(); key = JSON.stringify(body);
      const n = await countHintTokens({ apiKey: $("anthropicKey").value.trim(), body });
      if (key !== JSON.stringify(contextRequest())) {
        st.textContent = "Context changed while counting. Count again for updated input tokens.";
        return;
      }
      countedContext = key;
      st.textContent = `API count: ${n.toLocaleString()} input tokens for an empty-transcript hint, including the response format. Live transcript and interview history add tokens. This count does not measure cache hits.`;
    } catch (e) {
      st.textContent = key && key !== JSON.stringify(contextRequest())
        ? "Context changed while counting. Count again for updated input tokens." : e.message;
    }
    finally { finish(); $("btnCountCtx").disabled = false; }
  };

  $("btnExtract").onclick = () => profileTask(async () => {
    const st = $("extractStatus");
    if (!$("anthropicKey").value.trim()) { st.textContent = "Add an Anthropic key first (Start tab)."; return; }
    if (!$("cvText").value.trim()) { st.textContent = "Upload or paste a CV first."; return; }
    const finish = beginStatusActivity(st, "Drafting stories with Claude…");
    $("btnExtract").disabled = true;
    try {
      const out = await extractStories({
        apiKey: $("anthropicKey").value.trim(), model: $("model").value.trim(),
        cvText: $("cvText").value, jobDescription: $("jobDescription").value,
        resources: applyTier({ resources }, $("contextTier").value).resources,
      });
      stories = [...stories, ...out.stories.map((s) => ({ ...s, source: "cv" }))];
      likely = normalizeLikely(out.likely_questions);
      renderStories(); renderLikely(); renderInterview(); await save(); renderContext();
      st.textContent = `Drafted ${out.stories.length} stories and saved. Edit them until they sound like you.`;
    } catch (e) { st.textContent = e.message; }
    finally { finish(); $("btnExtract").disabled = false; }
  });
})();
