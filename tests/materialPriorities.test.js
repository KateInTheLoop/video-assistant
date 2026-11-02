import { test } from "node:test";
import assert from "node:assert/strict";
import { materialPriority, materialOwner, rankedMaterials, materialPlan, materialsText, applyTier, MAX_MATERIALS_CHARS } from "../lib/context.js";
import { buildHintRequest, buildPrewarmRequest, contextReport } from "../lib/hintRequest.js";
import { migrate, applyFlat, addJob, flatten, setActive } from "../lib/profiles.js";
import { importProfile, exportProfile } from "../lib/bank.js";
import { extractStories, gapReport, storyFromAnswer } from "../claude.js";

test("notes default highest; ties favor this job; explicit priorities and Off are respected", () => {
  const resources = [{ kind: "company", text: "Company" }, { kind: "notes", text: "General notes" }, { kind: "notes", text: "Job notes", scope: "job" }];
  assert.equal(materialPriority(resources[0]), 3);
  assert.equal(materialPriority(resources[1]), 5);
  assert.deepEqual(rankedMaterials(resources).map(e => e.resource.text), ["Job notes", "General notes", "Company"]);
  assert.equal(materialOwner(resources[1]), "candidate", "legacy notes retain their scope");
  const text = materialsText([{ kind: "notes", text: "Lowered note", priority: 1 }, { kind: "company", text: "Raised company", priority: 5 }, { kind: "notes", text: "Excluded topic", priority: 0 }]);
  assert.ok(text.indexOf("Raised company") < text.indexOf("Lowered note"));
  assert.doesNotMatch(text, /Excluded topic/);
});

test("large background cannot crowd out notes; truncation is reported per material", () => {
  const resources = [{ kind: "company", text: "x".repeat(MAX_MATERIALS_CHARS * 2) }, { kind: "notes", scope: "job", text: "Interview focus: prioritize inventory reconciliation examples." }];
  const plan = materialPlan(resources);
  assert.match(plan.text, /Interview focus: prioritize inventory reconciliation/);
  assert.ok(plan.text.indexOf("Interview focus:") < plan.text.indexOf("Company research"));
  assert.equal(plan.entries.find(e => e.resource.kind === "notes").status, "included");
  assert.equal(plan.entries.find(e => e.resource.kind === "company").status, "truncated");
  assert.ok(plan.text.length < MAX_MATERIALS_CHARS + 120);
  assert.equal(plan.truncated, true);
});

test("notes reach the actual live and cached requests in every tier; Off never reaches them", () => {
  const resources = [{ kind: "company", text: "Background company text" }, { kind: "notes", scope: "job", text: "Expected domain: inventory costing. Emphasize reconciliation skills." }, { kind: "notes", text: "Off private draft", priority: 0 }];
  for (const tier of ["lean", "standard", "full"]) {
    const ctx = { model: "example", transcript: [], resources, cvText: "CV facts", tier };
    const request = buildHintRequest(ctx), warm = buildPrewarmRequest(ctx);
    const prefix = request.system.at(-1).text;
    assert.match(prefix, /Expected domain: inventory costing/);
    assert.doesNotMatch(prefix, /Off private draft/);
    if (tier !== "full") assert.doesNotMatch(prefix, /Background company text/);
    assert.equal(request.system[0].text.includes("A Must focus note should materially shape"), true);
    assert.ok(prefix.indexOf("Expected domain:") < prefix.indexOf("# Story bank"));
    assert.deepEqual(warm.system, request.system);
    assert.equal(contextReport(ctx).parts.find(p => p.label === "Additional materials").included, true);
  }
  assert.equal(applyTier({ resources }, "lean").resources.length, 1);
});

test("job-specific notes stay with that job and retain priorities through transfer", () => {
  const jobNote = { kind: "notes", scope: "job", priority: 5, text: "Interview A domain" };
  const general = { kind: "notes", scope: "candidate", priority: 4, text: "General strengths" };
  let p = applyFlat(migrate(), { resources: [jobNote, general] });
  assert.equal(p.jobs["j-1"].resources[0].text, jobNote.text);
  p = addJob(p, { title: "Job B" }).profiles;
  assert.deepEqual(flatten(p).resources.map(r => r.text), [general.text]);
  p = setActive(p, { job: "j-1" });
  assert.equal(flatten(p).resources.find(r => r.text === jobNote.text).priority, 5);
  assert.deepEqual(importProfile(exportProfile("job", p.jobs["j-1"])).data.resources, [jobNote]);
  const invalid = importProfile({ kind: "candidate", data: { resources: [{ kind: "notes", text: "Notes", priority: 999, scope: "job" }] } });
  assert.deepEqual(invalid.data.resources, [{ kind: "notes", text: "Notes", priority: 5, scope: "candidate" }]);
});

test("story prep, guided answers and likely-question calls also receive prioritized guidance", async () => {
  const previous = globalThis.fetch, requests = [];
  globalThis.fetch = async (_url, options) => {
    requests.push(JSON.parse(options.body));
    return new Response(JSON.stringify({ content: [{ type: "text", text: JSON.stringify({ stories: [], likely_questions: [], questions: [], title: "Example" }) }] }));
  };
  try {
    const resources = [{ kind: "company", text: "Background context" }, { kind: "notes", scope: "job", text: "Focus on inventory costing" }, { kind: "notes", text: "Excluded briefing", priority: 0 }];
    const args = { apiKey: "example-test", cvText: "CV", jobDescription: "Job", stories: [], resources };
    await extractStories(args); await gapReport(args); await storyFromAnswer({ ...args, question: "Example?", tag: "impact", answer: "Example answer" });
    assert.equal(requests.length, 3);
    for (const request of requests) {
      const text = request.messages[0].content;
      assert.match(text, /Focus on inventory costing/);
      assert.ok(text.indexOf("Focus on inventory costing") < text.indexOf("Background context"));
      assert.doesNotMatch(text, /Excluded briefing/);
      assert.match(request.system, /Expected topics are expectations/);
    }
  } finally { globalThis.fetch = previous; }
});
