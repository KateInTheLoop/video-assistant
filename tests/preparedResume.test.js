import { test } from "node:test";
import assert from "node:assert/strict";
import { preparedResume, RESUME_SUMMARY_KIND, RESUME_SUMMARY_LABEL } from "../lib/preparedResume.js";
import { RESOURCE_KINDS, materialPriority, materialOwner, normalizeMaterial, materialPlan, applyTier, MAX_MATERIALS_CHARS } from "../lib/context.js";
import { buildHintRequest, buildPrewarmRequest, contextReport } from "../lib/hintRequest.js";
import { exportProfile, importProfile } from "../lib/bank.js";
import { migrate, applyFlat, flatten, addJob, setActive } from "../lib/profiles.js";

const answer = (text, fields = {}) => ({ kind: RESUME_SUMMARY_KIND, text, ...fields });

test("prepared answer is high-priority job guidance without a separate storage field", () => {
  const resource = answer("A prepared career opening.");
  assert.equal(RESOURCE_KINDS.find(kind => kind.id === RESUME_SUMMARY_KIND).label, RESUME_SUMMARY_LABEL);
  assert.equal(materialPriority(resource), 5);
  assert.equal(materialOwner(resource), "job");
  assert.deepEqual(normalizeMaterial(resource), { ...resource, priority: 5, scope: "job" });
  let profiles = applyFlat(migrate(), { resources: [resource] });
  assert.deepEqual(profiles.jobs["j-1"].resources, [resource]);
  assert.equal(profiles.candidates["c-1"].resources.length, 0);
  profiles = addJob(profiles, { title: "Another interview" }).profiles;
  assert.deepEqual(flatten(profiles).resources, []);
  profiles = setActive(profiles, { job: "j-1" });
  assert.equal(preparedResume(flatten(profiles).resources).text, resource.text);
});

test("selection respects priority before scope, then job scope and stable insertion order", () => {
  const candidate = answer("General opening", { scope: "candidate", priority: 5 });
  const job = answer("Job opening", { scope: "job", priority: 4 });
  assert.equal(preparedResume([job, candidate]), candidate);
  job.priority = 5;
  assert.equal(preparedResume([candidate, job]), job);
  assert.equal(preparedResume([job, candidate, answer("Later job opening", { scope: "job", priority: 5 })]), job);
  assert.equal(preparedResume([candidate, answer("Later general opening", { scope: "candidate", priority: 5 })]), candidate);
  const defaultJob = answer("Default job opening");
  assert.equal(preparedResume([candidate, defaultJob]), defaultJob);
});

test("malformed, empty and disabled answers cannot win; normalization rules stay consistent", () => {
  const valid = answer("Enabled answer", { priority: 1 });
  assert.equal(preparedResume([null, undefined, 1, "summary", {}, { kind: RESUME_SUMMARY_KIND, text: 12 }, answer(" \n "), answer("Off answer", { priority: 0 }), { kind: "notes", text: "Generic notes", priority: 5 }, valid]), valid);
  for (const input of [null, undefined, {}, "not a material list", [null]]) assert.equal(preparedResume(input), null);
  for (const priority of [-1, 6, 1.5, "4", null]) {
    const resource = answer("Defaults after invalid priority", { priority, scope: "invalid" });
    assert.equal(materialPriority(resource), 5);
    assert.equal(materialOwner(resource), "job");
    assert.equal(preparedResume([valid, resource]), resource);
  }
});

test("the original selected wording is preserved and competing answers are superseded", () => {
  const original = "  I began in operations.\n\nThen I moved into reporting.  \n";
  const general = answer("Different general wording", { scope: "candidate" });
  const selected = answer(original, { scope: "job" });
  const resources = [general, selected];
  const before = structuredClone(resources);
  assert.equal(preparedResume(resources), selected);
  const plan = materialPlan(resources);
  assert.ok(plan.text.endsWith(original), "the prepared text must not be trimmed or rewritten");
  assert.doesNotMatch(plan.text, /Different general wording/);
  assert.match(plan.text, /Selected prepared resume answer/);
  assert.equal(plan.preparedResume.resource, selected);
  assert.equal(plan.preparedResume.index, 1);
  assert.equal(plan.preparedResume.status, "included");
  assert.equal(plan.preparedResume.sentChars, original.length);
  assert.equal(plan.preparedResume.totalChars, original.length);
  assert.equal(plan.preparedResume.complete, true);
  assert.equal(plan.entries.find(entry => entry.resource === general).status, "superseded");
  assert.equal(plan.truncated, false, "superseding an alternate is deliberate selection, not budget truncation");
  assert.deepEqual(resources, before);
});

test("a lower-priority summary cannot displace Must focus guidance and remains available locally", () => {
  const selected = answer("I started in customer operations and grew into a reporting role.", { priority: 1 });
  const notes = { kind: "notes", scope: "job", priority: 5, text: "Expected topics: " + "x".repeat(MAX_MATERIALS_CHARS) };
  const background = { kind: "company", priority: 5, text: "Background: " + "y".repeat(MAX_MATERIALS_CHARS) };
  const plan = materialPlan([notes, background, selected], 400);
  assert.equal(plan.entries[0].resource, notes);
  assert.equal(plan.preparedResume.status, "omitted");
  assert.equal(plan.preparedResume.complete, false);
  assert.doesNotMatch(plan.text, /I started in customer operations/);
  assert.equal(preparedResume([notes, background, selected]), selected);
  assert.equal(plan.preparedResume.resource.text, selected.text);
  assert.equal(plan.entries.find(entry => entry.resource === notes).status, "truncated");
  assert.equal(plan.entries.find(entry => entry.resource === background).status, "omitted");
});

test("an oversized prepared answer reports its exact excerpt rather than claiming complete delivery", () => {
  const selected = answer("Opening sentence. " + "x".repeat(MAX_MATERIALS_CHARS) + " Unsent ending.");
  const plan = materialPlan([selected]);
  assert.equal(plan.preparedResume.status, "truncated");
  assert.equal(plan.preparedResume.complete, false);
  assert.equal(plan.preparedResume.totalChars, selected.text.length);
  assert.ok(plan.preparedResume.sentChars > 0 && plan.preparedResume.sentChars < selected.text.length);
  assert.ok(plan.text.includes(selected.text.slice(0, plan.preparedResume.sentChars)));
  assert.match(plan.text, /Selected prepared resume answer \(excerpt\)/);
  assert.match(plan.text, /selected prepared resume answer is an excerpt/);
  assert.doesNotMatch(plan.text, /Unsent ending/);
  assert.ok(plan.text.length < MAX_MATERIALS_CHARS + 120);
  const omitted = materialPlan([selected], 1);
  assert.equal(omitted.preparedResume.status, "omitted");
  assert.equal(omitted.preparedResume.sentChars, 0);
  assert.equal(omitted.preparedResume.complete, false);
  assert.match(omitted.text, /selected prepared resume answer omitted/);
});

test("selected prepared guidance reaches live and cached prompts in every tier", () => {
  const general = answer("Candidate's generic opening", { scope: "candidate" });
  const selected = answer("This job's exact prepared opening", { scope: "job" });
  const resources = [general, { kind: "company", text: "Background company context" }, selected,
    answer("Disabled prepared answer", { priority: 0 }), { kind: "notes", text: "Interview guidance" }];
  for (const tier of ["lean", "standard", "full"]) {
    const filtered = applyTier({ resources }, tier).resources;
    assert.equal(preparedResume(filtered), selected);
    const input = { model: "example", transcript: [], resources, tier };
    const request = buildHintRequest(input), prewarm = buildPrewarmRequest(input);
    const prompt = request.system.at(-1).text;
    assert.ok(prompt.includes(selected.text));
    assert.ok(prompt.indexOf("Interview guidance") < prompt.indexOf(selected.text), "coach notes retain their priority in AI context");
    assert.doesNotMatch(prompt, /Candidate's generic opening|Disabled prepared answer/);
    if (tier !== "full") assert.doesNotMatch(prompt, /Background company context/);
    assert.deepEqual(prewarm.system, request.system);
    const component = contextReport(input).parts.find(part => part.label === "Additional materials");
    assert.equal(component.included, true);
    assert.equal(component.count, tier === "full" ? 3 : 2, "count only delivered sources, excluding the superseded answer");
  }
});

test("job and candidate transfers retain the prepared type, scope, priority and exact text", () => {
  const text = "  Prepared opening.\n\nPrepared closing.  ";
  for (const kind of ["candidate", "job"]) {
    const resource = normalizeMaterial(answer(text, { priority: 4 }), kind);
    const restored = importProfile(exportProfile(kind, { resources: [resource] })).data.resources;
    assert.deepEqual(restored, [resource]);
    assert.equal(preparedResume(restored).text, text);
  }
});
