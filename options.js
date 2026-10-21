import { loadSettings, saveSettings } from "./storage.js";
import { extractStories } from "./claude.js";

const $ = (id) => document.getElementById(id);
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
  for (const q of likely) { const li = document.createElement("li"); li.textContent = q; $("likely").appendChild(li); }
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
    el.innerHTML = `<b>${when}</b> · ${mins} min · ${s.lines.length} lines<details><summary>Transcript</summary><pre></pre></details>`;
    el.querySelector("pre").textContent = text;
    box.appendChild(el);
  }
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
  stories = s.stories || [];
  likely = (await chrome.storage.local.get("likelyQuestions")).likelyQuestions || [];
  renderStories(); renderLikely(); renderSessions();

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
      stories = [...stories, ...out.stories];
      likely = out.likely_questions;
      renderStories(); renderLikely();
      st.textContent = `Drafted ${out.stories.length} stories. Edit them, then Save.`;
    } catch (e) { st.textContent = e.message; }
    finally { $("btnExtract").disabled = false; }
  };
})();
