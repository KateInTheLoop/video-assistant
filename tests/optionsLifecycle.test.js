import { test } from "node:test";
import assert from "node:assert/strict";
import { browserHarness, deferred } from "./browserHarness.js";
import { migrate, addCandidate, addJob, applyFlat, flatten } from "../lib/profiles.js";

async function settingsHarness(overrides = {}) {
  let profiles = migrate({ candidateName: "Candidate A", cvText: "CV A" });
  profiles = addCandidate(profiles, { name: "Candidate B", cvText: "CV B" }).profiles;
  profiles = addJob(profiles, { title: "Job B" }).profiles;
  profiles.activeCandidate = "c-1"; profiles.activeJob = "j-1";
  const h = await browserHarness("options.js", {
    loadSettings: async () => structuredClone({ profiles, ...flatten(profiles), model: "claude-haiku-5-5", contextTier: "full", anthropicKey: "sk-ant-example-test-key-00000000" }),
    saveSettings: async partial => { profiles = partial.profiles || applyFlat(profiles, partial); },
    chrome: { storage: { local: { get: async () => ({}) } } },
    ...overrides,
  });
  return { ...h, stored: () => profiles };
}

test("drafting locks both profiles through saving and never writes into another candidate", async () => {
  const result = deferred();
  const h = await settingsHarness({ extractStories: () => result.promise });
  const task = h.$("btnExtract").onclick();
  assert.equal(h.$("candidateSel").disabled, true);
  assert.equal(h.$("jobSel").disabled, true);
  assert.equal(h.$("extractStatus").getAttribute("aria-busy"), "true");
  assert.equal(h.$("extractStatus").getAttribute("role"), "status");
  assert.equal(h.$("profileBusy").getAttribute("aria-busy"), "true");
  // Even a queued/programmatic change cannot bypass the disabled controls.
  h.$("candidateSel").value = "c-2";
  await h.$("candidateSel").onchange();
  assert.equal(h.stored().activeCandidate, "c-1");
  result.resolve({ stories: [{ title: "A's story" }], likely_questions: ["Question A"] });
  await task;
  assert.equal(h.stored().candidates["c-1"].stories[0].title, "A's story");
  assert.equal(h.stored().candidates["c-2"].stories.length, 0);
  assert.equal(h.$("candidateSel").disabled, false);
  assert.equal(h.$("extractStatus").getAttribute("aria-busy"), "false");
  assert.equal(h.$("profileBusy").getAttribute("aria-busy"), "false");
  await h.$("candidateSel").onchange();
  assert.equal(h.stored().activeCandidate, "c-2");
});

test("CV upload locks before file read and saves before releasing the profile", async () => {
  const bytes = deferred();
  const h = await settingsHarness({ cvTextFromFile: async () => "Uploaded CV A" });
  h.$("cvFile").files = [{ name: "resume.txt", size: 10, arrayBuffer: () => bytes.promise }];
  const task = h.$("cvFile").onchange();
  assert.equal(h.$("candidateSel").disabled, true);
  assert.equal(h.$("cvStatus").getAttribute("aria-busy"), "true");
  bytes.resolve(new ArrayBuffer(0));
  await task;
  assert.equal(h.stored().candidates["c-1"].cvText, "Uploaded CV A");
  assert.equal(h.stored().candidates["c-2"].cvText, "CV B");
  assert.equal(h.$("candidateSel").disabled, false);
  assert.equal(h.$("cvStatus").getAttribute("aria-busy"), "false");
});

test("overlapping tasks keep selection locked until all finish, including failure", async () => {
  const draft = deferred(), gaps = deferred();
  const h = await settingsHarness({ extractStories: () => draft.promise, gapReport: () => gaps.promise });
  h.run('stories = [{ title: "Existing story" }]');
  const a = h.$("btnExtract").onclick(), b = h.$("btnGaps").onclick();
  gaps.resolve([]);
  await b;
  assert.equal(h.$("candidateSel").disabled, true);
  assert.equal(h.$("profileBusy").getAttribute("aria-busy"), "true");
  assert.equal(h.$("gapStatus").getAttribute("aria-busy"), "false");
  assert.equal(h.$("extractStatus").getAttribute("aria-busy"), "true");
  draft.reject(new Error("Simulated API failure"));
  await a;
  assert.equal(h.$("candidateSel").disabled, false);
  assert.equal(h.$("extractStatus").textContent, "Simulated API failure");
  assert.equal(h.$("extractStatus").getAttribute("aria-busy"), "false");
  assert.equal(h.$("profileBusy").getAttribute("aria-busy"), "false");
  assert.equal(h.$("btnExtract").disabled, false);
});

test("drafting activity remains visible through saving and clears after a save failure", async () => {
  const result = deferred(), saving = deferred(), saved = deferred();
  const h = await settingsHarness({
    extractStories: () => result.promise,
    saveSettings: async () => { saving.resolve(); await saved.promise; },
  });
  const task = h.$("btnExtract").onclick();
  result.resolve({ stories: [{ title: "Example story" }], likely_questions: [] });
  await saving.promise;
  assert.equal(h.$("extractStatus").getAttribute("aria-busy"), "true");
  assert.equal(h.$("btnExtract").disabled, true);
  saved.reject(new Error("Simulated save failure"));
  await task;
  assert.equal(h.$("extractStatus").getAttribute("aria-busy"), "false");
  assert.equal(h.$("btnExtract").disabled, false);
  assert.equal(h.$("extractStatus").textContent, "Simulated save failure");
});

test("key checks keep shared feedback busy and recover after a rejected request", async () => {
  const result = deferred();
  let requests = 0;
  const h = await settingsHarness({
    checkAnthropicKey: () => result.promise,
    checkDeepgramKey: async () => { requests++; return { ok: true, reason: "Valid key" }; },
  });
  const task = h.$("btnTestAnthropic").onclick();
  assert.equal(h.$("keyTest").getAttribute("aria-busy"), "true");
  for (const id of ["btnTestAnthropic", "btnTestAssemblyai", "btnTestDeepgram"]) assert.equal(h.$(id).disabled, true);
  await h.$("btnTestDeepgram").onclick();
  assert.equal(requests, 0, "a second check cannot replace pending shared feedback");
  result.reject(new Error("Simulated connection failure"));
  await task;
  assert.equal(h.$("keyTest").getAttribute("aria-busy"), "false");
  assert.equal(h.$("keyTest").textContent, "Simulated connection failure");
  for (const id of ["btnTestAnthropic", "btnTestAssemblyai", "btnTestDeepgram"]) assert.equal(h.$(id).disabled, false);
  await h.$("btnTestDeepgram").onclick();
  assert.equal(requests, 1);
  assert.equal(h.$("keyTest").getAttribute("aria-busy"), "false");
  assert.equal(h.$("keyTest").textContent, "Deepgram: Valid key");
});

test("switching clears the previous candidate's unsaved guided answer", async () => {
  const h = await settingsHarness();
  h.$("giAnswer").value = "Private draft for candidate A";
  h.$("candidateSel").value = "c-2";
  await h.$("candidateSel").onchange();
  assert.equal(h.$("giAnswer").value, "");
  assert.equal(h.stored().activeCandidate, "c-2");
});

test("API counts include response format and become stale when the context changes", async () => {
  const result = deferred();
  let sent;
  const h = await settingsHarness({ countHintTokens: ({ body }) => { sent = body; return result.promise; } });
  const task = h.$("btnCountCtx").onclick();
  assert.equal(h.$("ctxStatus").getAttribute("aria-busy"), "true");
  assert.equal(sent.output_config.format.type, "json_schema");
  result.resolve(9000);
  await task;
  assert.match(h.$("ctxStatus").textContent, /9,000.*including the response format/);
  assert.equal(h.$("ctxStatus").getAttribute("aria-busy"), "false");
  h.$("cvText").value = "Updated synthetic CV";
  h.run('document.dispatchEvent(new Event("input"))');
  assert.match(h.$("ctxStatus").textContent, /Context changed/);
  assert.doesNotMatch(h.$("ctxStatus").textContent, /9,000/);
});

test("a context change during counting rejects the outdated API result and clears activity", async () => {
  const result = deferred();
  const h = await settingsHarness({ countHintTokens: () => result.promise });
  const task = h.$("btnCountCtx").onclick();
  h.$("jobDescription").value = "A different synthetic job";
  result.resolve(9000);
  await task;
  assert.match(h.$("ctxStatus").textContent, /Context changed while counting/);
  assert.doesNotMatch(h.$("ctxStatus").textContent, /9,000/);
  assert.equal(h.$("ctxStatus").getAttribute("aria-busy"), "false");
  assert.equal(h.$("btnCountCtx").disabled, false);
});

test("failed token counts clear pending feedback and allow another request", async () => {
  const result = deferred();
  const h = await settingsHarness({ countHintTokens: () => result.promise });
  const task = h.$("btnCountCtx").onclick();
  assert.equal(h.$("ctxStatus").getAttribute("aria-busy"), "true");
  result.reject(new Error("Simulated count failure"));
  await task;
  assert.equal(h.$("ctxStatus").textContent, "Simulated count failure");
  assert.equal(h.$("ctxStatus").getAttribute("aria-busy"), "false");
  assert.equal(h.$("btnCountCtx").disabled, false);
});

test("material controls save priority and scope, and job notes do not leak across jobs", async () => {
  const h = await settingsHarness();
  const find = (node, predicate) => predicate(node) ? node : (node.children || []).map(child => find(child, predicate)).find(Boolean);
  h.$("btnAddRes").onclick();
  let card = h.$("resources").children[0];
  let slider = find(card, node => node.type === "range");
  assert.equal(slider.value, "5");
  assert.equal(find(card, node => node.getAttribute?.("aria-label") === "Applies to").value, "job");
  const notes = find(card, node => node.placeholder?.startsWith("Expected topics"));
  notes.value = "Expect inventory questions; emphasize reconciliation experience."; notes.oninput();
  slider.value = "4"; slider.oninput(); slider.onchange();
  await h.$("btnSave").onclick();
  assert.equal(h.stored().jobs["j-1"].resources[0].priority, 4);
  assert.equal(h.stored().candidates["c-1"].resources.length, 0);
  h.$("jobSel").value = "j-2"; await h.$("jobSel").onchange();
  assert.equal(h.$("resources").children.length, 0);
  h.$("jobSel").value = "j-1"; await h.$("jobSel").onchange();
  card = h.$("resources").children[0];
  const scope = find(card, node => node.getAttribute?.("aria-label") === "Applies to");
  scope.value = "candidate"; scope.onchange();
  await h.$("btnSave").onclick();
  assert.equal(h.stored().candidates["c-1"].resources[0].scope, "candidate");
  assert.equal(h.stored().jobs["j-1"].resources.length, 0);
});

test("a prepared resume summary defaults to this job and survives an explicit change to all jobs", async () => {
  const h = await settingsHarness();
  const find = (node, predicate) => predicate(node) ? node : (node.children || []).map(child => find(child, predicate)).find(Boolean);
  h.$("btnAddResumeSummary").onclick();
  let card = h.$("resources").children[0];
  assert.equal(find(card, node => node.getAttribute?.("aria-label") === "Material type").value, "resume_summary");
  assert.equal(find(card, node => node.type === "range").value, "5");
  assert.equal(find(card, node => node.getAttribute?.("aria-label") === "Applies to").value, "job");
  const answer = "I began in operational support.\n\nI now focus on reporting and controls.";
  const text = find(card, node => node.placeholder?.startsWith("Paste your exact prepared answer"));
  text.value = answer; text.oninput();
  h.$("contextTier").value = "lean";
  h.run("renderContext()");
  assert.match(h.$("resBudget").textContent, /1 of 1 enabled material included/);
  await h.$("btnSave").onclick();
  assert.equal(h.stored().jobs["j-1"].resources[0].text, answer);
  assert.equal(h.stored().jobs["j-1"].resources[0].kind, "resume_summary");
  assert.equal(h.stored().jobs["j-1"].resources[0].priority, 5);
  assert.equal(h.stored().candidates["c-1"].resources.length, 0);
  assert.equal(h.$("resumePreviewText").textContent, answer);
  h.$("jobSel").value = "j-2"; await h.$("jobSel").onchange();
  assert.equal(h.$("resources").children.length, 0);
  assert.equal(h.$("resumePreview").hidden, true);
  assert.equal(h.$("resumePreviewText").textContent, "");
  h.$("jobSel").value = "j-1"; await h.$("jobSel").onchange();
  card = h.$("resources").children[0];
  const scope = find(card, node => node.getAttribute?.("aria-label") === "Applies to");
  scope.value = "candidate"; scope.onchange();
  await h.$("btnSave").onclick();
  assert.equal(h.stored().jobs["j-1"].resources.length, 0);
  assert.equal(h.stored().candidates["c-1"].resources[0].text, answer);
  assert.equal(h.stored().candidates["c-1"].resources[0].scope, "candidate");
  h.$("jobSel").value = "j-2"; await h.$("jobSel").onchange();
  assert.equal(h.$("resources").children.length, 1);
});

test("converting a note into a resume summary preserves its exact text, priority and scope", async () => {
  const h = await settingsHarness();
  const find = (node, predicate) => predicate(node) ? node : (node.children || []).map(child => find(child, predicate)).find(Boolean);
  h.$("btnAddRes").onclick();
  let card = h.$("resources").children[0];
  const original = "  My opening answer keeps this sequence.\n\nThen I connect it to this role.  ";
  const notes = find(card, node => node.placeholder?.startsWith("Expected topics"));
  notes.value = original; notes.oninput();
  const priority = find(card, node => node.type === "range");
  priority.value = "4"; priority.oninput(); priority.onchange();
  card = h.$("resources").children[0];
  const kind = find(card, node => node.getAttribute?.("aria-label") === "Material type");
  assert.equal(kind.value, "notes", "text alone does not classify a note as a prepared answer");
  kind.value = "resume_summary"; kind.onchange();
  card = h.$("resources").children[0];
  assert.equal(find(card, node => node.placeholder?.startsWith("Paste your exact prepared answer")).value, original);
  await h.$("btnSave").onclick();
  const saved = h.stored().jobs["j-1"].resources[0];
  assert.equal(saved.kind, "resume_summary");
  assert.equal(saved.text, original);
  assert.equal(saved.priority, 4);
  assert.equal(saved.scope, "job");
});

test("material status distinguishes the selected resume summary from a superseded answer", async () => {
  const h = await settingsHarness();
  h.$("contextTier").value = "lean";
  h.run(`resources = [
    { kind: "notes", text: "Emphasize controls.", priority: 5, scope: "job" },
    { kind: "resume_summary", text: "My general prepared opening.", priority: 5, scope: "candidate" },
    { kind: "resume_summary", text: "My opening tailored to this role.", priority: 5, scope: "job" }
  ]; renderResources();`);
  const statuses = Array.from(h.run("[...resourceStatuses.values()].map(label => label.textContent)"));
  assert.equal(statuses.filter(text => text === "Included in AI context").length, 2);
  assert.equal(statuses.filter(text => text.startsWith("Another prepared resume answer is selected")).length, 1);
  assert.match(h.$("resBudget").textContent, /2 of 3 enabled materials included/);
  h.run("resources[2].priority = 0; renderResources()");
  const changed = Array.from(h.run("[...resourceStatuses.values()].map(label => label.textContent)"));
  assert.equal(changed.filter(text => text === "Included in AI context").length, 2);
  assert.equal(changed.filter(text => text.startsWith("Another prepared resume answer is selected")).length, 0);
  assert.match(h.$("resBudget").textContent, /2 of 2 enabled materials included/);
});

test("an oversized prepared answer distinguishes the model excerpt from the full saved answer", async () => {
  const h = await settingsHarness();
  h.run('resources = [{ kind: "resume_summary", text: "Synthetic prepared opening. ".repeat(1200), priority: 5, scope: "job" }]; renderResources()');
  const statuses = Array.from(h.run("[...resourceStatuses.values()].map(label => label.textContent)"));
  assert.match(statuses[0], /AI receives an excerpt/);
  assert.match(statuses[0], /coach displays your full saved answer/);
  assert.match(h.$("resBudget").textContent, /1 of 1 enabled material included/);
});

test("Start exposes guidance readiness and its review shortcut moves keyboard focus to the section", async () => {
  const h = await settingsHarness();
  assert.match(h.$("guidanceStatus").textContent, /No interview notes yet/);
  assert.match(h.$("resumeReadyStatus").textContent, /No prepared resume answer yet/);
  assert.equal(h.$("resumePreview").hidden, true);
  h.$("btnReviewGuidance").onclick();
  assert.equal(h.$("pane-content").hidden, false);
  assert.equal(h.$("pane-start").hidden, true);
  assert.equal(h.context.document.activeElement, h.$("guidanceHeading"));
});

test("adding notes focuses the new editor and updates the visible readiness and badge while typing", async () => {
  const h = await settingsHarness();
  const find = (node, predicate) => predicate(node) ? node : (node.children || []).map(child => find(child, predicate)).find(Boolean);
  h.$("btnAddRes").onclick();
  const card = h.$("resources").children[0];
  const editor = find(card, node => node.getAttribute?.("aria-label") === "Your interview notes");
  const badge = find(card, node => node.className === "resource-badge");
  assert.equal(h.context.document.activeElement, editor);
  assert.equal(badge.textContent, "Empty draft");
  editor.value = "Focus on reporting controls and month-end reconciliations."; editor.oninput();
  assert.equal(badge.textContent, "Included");
  assert.match(h.$("guidanceStatus").textContent, /1 fully included/);
  assert.equal(card.dataset.state, "included");
  const kind = find(card, node => node.getAttribute?.("aria-label") === "Material type");
  kind.value = "resume_summary"; kind.onchange();
  const converted = h.$("resources").children[0];
  assert.equal(h.context.document.activeElement, find(converted, node => node.getAttribute?.("aria-label") === "Material type"));
  assert.equal(h.$("resumePreviewText").textContent, editor.value);
});

test("selected-answer visibility follows exact wording, priorities and scope without claiming alternates are active", async () => {
  const h = await settingsHarness();
  h.run(`profiles.jobs["j-1"].title = "Example Accounting Job"; resources = [
    { kind: "notes", text: "Emphasize reporting controls", priority: 5, scope: "job" },
    { kind: "resume_summary", text: "  Candidate-wide opening.\\n\\nGeneral closing.  ", priority: 5, scope: "candidate" },
    { kind: "resume_summary", text: "  Job-specific opening.\\n\\nTailored closing.  ", priority: 5, scope: "job" }
  ]; renderResources();`);
  assert.match(h.$("guidanceContext").textContent, /Candidate A.*Example Accounting Job/);
  assert.match(h.$("resumeReadyStatus").textContent, /Resume answer selected.*This job: Example Accounting Job/);
  assert.equal(h.$("resumePreviewText").textContent, "  Job-specific opening.\n\nTailored closing.  ");
  assert.equal(h.$("resumePreview").hidden, false);
  const badges = () => Array.from(h.run("[...resourceViews.values()].map(view => view.badge.textContent)"));
  assert.equal(badges().filter(text => text === "Selected for resume questions").length, 1);
  assert.equal(badges().filter(text => text === "Alternate answer").length, 1);
  h.$("resumePreview").open = true;
  h.run('resources[2].text = "Updated draft wording"; renderMaterialStatus()');
  assert.equal(h.$("resumePreviewText").textContent, "Updated draft wording");
  assert.equal(h.$("resumePreview").open, true, "editing the same selected answer keeps its preview open");
  h.run('resources[2].priority = 0; renderResources()');
  assert.equal(h.$("resumePreviewText").textContent, "  Candidate-wide opening.\n\nGeneral closing.  ");
  assert.match(h.$("resumePreviewScope").textContent, /Candidate A — all jobs/);
  h.run('resources[1].priority = 0; renderResources()');
  assert.equal(h.$("resumePreview").hidden, true);
  assert.equal(h.$("resumePreviewText").textContent, "");
  assert.match(h.$("resumeReadyStatus").textContent, /answers are Off/);
});

test("a prepared answer remains visibly selected when higher-priority notes fill the model context", async () => {
  const h = await settingsHarness();
  h.run(`resources = [
    { kind: "notes", text: "Synthetic interview focus ".repeat(2000), priority: 5, scope: "job" },
    { kind: "resume_summary", text: "My complete prepared answer.", priority: 1, scope: "job" }
  ]; renderResources();`);
  assert.match(h.$("guidanceStatus").textContent, /1 partly included/);
  assert.match(h.$("resumeReadyStatus").textContent, /Resume answer selected/);
  assert.equal(h.$("resumePreviewText").textContent, "My complete prepared answer.");
  assert.equal(h.$("resumePreview").hidden, false);
  const statuses = Array.from(h.run("[...resourceStatuses.values()].map(label => label.textContent)"));
  assert.ok(statuses.some(text => text.startsWith("AI context budget omits this answer")));
  const badges = Array.from(h.run("[...resourceViews.values()].map(view => view.badge.textContent)"));
  assert.ok(badges.includes("Selected for resume questions"));
});
