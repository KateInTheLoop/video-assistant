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
  // Even a queued/programmatic change cannot bypass the disabled controls.
  h.$("candidateSel").value = "c-2";
  await h.$("candidateSel").onchange();
  assert.equal(h.stored().activeCandidate, "c-1");
  result.resolve({ stories: [{ title: "A's story" }], likely_questions: ["Question A"] });
  await task;
  assert.equal(h.stored().candidates["c-1"].stories[0].title, "A's story");
  assert.equal(h.stored().candidates["c-2"].stories.length, 0);
  assert.equal(h.$("candidateSel").disabled, false);
  await h.$("candidateSel").onchange();
  assert.equal(h.stored().activeCandidate, "c-2");
});

test("CV upload locks before file read and saves before releasing the profile", async () => {
  const bytes = deferred();
  const h = await settingsHarness({ cvTextFromFile: async () => "Uploaded CV A" });
  h.$("cvFile").files = [{ name: "resume.txt", size: 10, arrayBuffer: () => bytes.promise }];
  const task = h.$("cvFile").onchange();
  assert.equal(h.$("candidateSel").disabled, true);
  bytes.resolve(new ArrayBuffer(0));
  await task;
  assert.equal(h.stored().candidates["c-1"].cvText, "Uploaded CV A");
  assert.equal(h.stored().candidates["c-2"].cvText, "CV B");
  assert.equal(h.$("candidateSel").disabled, false);
});

test("overlapping tasks keep selection locked until all finish, including failure", async () => {
  const draft = deferred(), gaps = deferred();
  const h = await settingsHarness({ extractStories: () => draft.promise, gapReport: () => gaps.promise });
  h.run('stories = [{ title: "Existing story" }]');
  const a = h.$("btnExtract").onclick(), b = h.$("btnGaps").onclick();
  gaps.resolve([]);
  await b;
  assert.equal(h.$("candidateSel").disabled, true);
  draft.reject(new Error("Simulated API failure"));
  await a;
  assert.equal(h.$("candidateSel").disabled, false);
  assert.equal(h.$("extractStatus").textContent, "Simulated API failure");
});

test("switching clears the previous candidate's unsaved guided answer", async () => {
  const h = await settingsHarness();
  h.$("giAnswer").value = "Private draft for candidate A";
  h.$("candidateSel").value = "c-2";
  await h.$("candidateSel").onchange();
  assert.equal(h.$("giAnswer").value, "");
  assert.equal(h.stored().activeCandidate, "c-2");
});
