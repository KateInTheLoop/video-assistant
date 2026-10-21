import { loadSettings, saveSettings } from "./storage.js";
import { extractStories, storyFromAnswer, gapReport } from "./claude.js";
import { exportBank, importBank, mergeStories, normalizeLikely } from "./lib/bank.js";
import { STANDARD_QUESTIONS, nextIndex } from "./lib/storyInterview.js";
import { summarize } from "./lib/diag.js";

const $ = (id) => document.getElementById(id);
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fields = ["anthropicKey", "deepgramKey", "model", "candidateName", "cvText", "jobDescription"];
let stories = [];
let likely = [];

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
    card.querySelector("[data-del]").onclick = () => { stories.splice(i, 1); renderStories(); };
    box.appendChild(card);
  });
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
  $("giQuestion").textContent = active ? STANDARD_QUESTIONS[i].q : "All questions answered or skipped. Edit the stories below, then Save.";
  $("giAnswer").style.display = active ? "" : "none";
  $("giSave").disabled = !active; $("giSkip").disabled = !active;
}

async function save() {
  const partial = {};
  for (const f of fields) partial[f] = $(f).value.trim();
  partial.stories = stories.filter((s) => s.title?.trim());
  partial.likelyQuestions = likely;
  await saveSettings(partial);
  $("saveStatus").textContent = "Saved.";
  setTimeout(() => ($("saveStatus").textContent = ""), 1500);
}

(async () => {
  const s = await loadSettings();
  for (const f of fields) $(f).value = s[f] || "";
  if (![...$("model").options].some((o) => o.value === $("model").value)) $("model").value = "claude-opus-5-5";
  stories = s.stories || [];
  likely = (await chrome.storage.local.get("likelyQuestions")).likelyQuestions || [];
  renderStories(); renderLikely(); renderSessions(); renderDiag(); renderInterview();
  $("giSkip").onclick = () => { giSkipped.add(STANDARD_QUESTIONS[giIndex].tag); $("giAnswer").value = ""; renderInterview(); };
  $("giSave").onclick = async () => {
    const st = $("giStatus");
    const answer = $("giAnswer").value.trim();
    if (!$("anthropicKey").value.trim()) { st.textContent = "Add an Anthropic key first."; return; }
    if (answer.split(/\s+/).length < 15) { st.textContent = "Give a bit more detail (a few sentences)."; return; }
    const q = STANDARD_QUESTIONS[giIndex];
    st.textContent = "Tidying into a story card…"; $("giSave").disabled = true;
    try {
      const card = await storyFromAnswer({ apiKey: $("anthropicKey").value.trim(), model: $("model").value, question: q.q, tag: q.tag, answer });
      stories.push({ ...card, source: "interview", interviewTag: q.tag, missing: undefined,
        result: card.missing?.length ? `${card.result}\n\nStill missing: ${card.missing.join("; ")}` : card.result });
      $("giAnswer").value = "";
      st.textContent = `Saved "${card.title}". Remember to click Save at the bottom.`;
      renderStories(); renderInterview();
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
  if (location.hash === "#mic") $("mic").scrollIntoView();

  $("btnGaps").onclick = async () => {
    const st = $("gapStatus");
    if (!$("anthropicKey").value.trim()) { st.textContent = "Add an Anthropic key first."; return; }
    if (!stories.length) { st.textContent = "Add some stories first."; return; }
    st.textContent = "Asking Claude…"; $("btnGaps").disabled = true;
    try { likely = await gapReport({ apiKey: $("anthropicKey").value.trim(), model: $("model").value, jobDescription: $("jobDescription").value, stories }); renderLikely(); }
    catch (e) { st.textContent = e.message; }
    finally { $("btnGaps").disabled = false; }
  };
  $("btnExport").onclick = () => {
    const blob = new Blob([exportBank(stories, likely)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = `story-bank-${new Date().toISOString().slice(0, 10)}.json`; a.click();
    URL.revokeObjectURL(a.href);
  };
  $("btnImport").onclick = () => $("importFile").click();
  $("importFile").onchange = async () => {
    const file = $("importFile").files[0]; if (!file) return;
    try {
      const { stories: incoming, likelyQuestions } = importBank(await file.text());
      const r = mergeStories(stories, incoming);
      stories = r.stories; if (likelyQuestions.length && !likely.length) likely = likelyQuestions;
      renderStories(); renderLikely(); renderInterview();
      $("bankStatus").textContent = `Imported ${r.added} stories (${r.skipped} duplicates skipped). Click Save.`;
    } catch (e) { $("bankStatus").textContent = e.message; }
    $("importFile").value = "";
  };

  $("btnAddStory").onclick = () => { stories.push({ title: "", situation: "", action: "", result: "", tags: "" }); renderStories(); };
  $("btnSave").onclick = save;
  $("btnExtract").onclick = async () => {
    const st = $("extractStatus");
    if (!$("anthropicKey").value.trim()) { st.textContent = "Add an Anthropic key first."; return; }
    if (!$("cvText").value.trim()) { st.textContent = "Paste a CV first."; return; }
    st.textContent = "Asking Claude… (10-30 s)";
    $("btnExtract").disabled = true;
    try {
      const out = await extractStories({
        apiKey: $("anthropicKey").value.trim(), model: $("model").value.trim(),
        cvText: $("cvText").value, jobDescription: $("jobDescription").value,
      });
      stories = [...stories, ...out.stories.map((s) => ({ ...s, source: "cv" }))];
      likely = normalizeLikely(out.likely_questions);
      renderStories(); renderLikely();
      st.textContent = `Drafted ${out.stories.length} stories. Edit them, then Save.`;
    } catch (e) { st.textContent = e.message; }
    finally { $("btnExtract").disabled = false; }
  };
})();
