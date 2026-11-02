import { test } from "node:test";
import assert from "node:assert/strict";
import {
  emptyProfiles, addCandidate, addJob, duplicateCandidate, duplicateJob, removeCandidate, removeJob,
  setActive, flatten, applyFlat, migrate, isProfiles, jobLabel, candidateLabel, updateJob, newId,
} from "../lib/profiles.js";

const flat = {
  candidateName: "Jane Doe",
  cvText: "Jane Doe\n- Owned month-end close",
  stories: [{ title: "Billing migration", situation: "s", action: "a", result: "r", tags: "impact" }],
  jobDescription: "Senior Accountant\nOwns the close.",
  likelyQuestions: ["Why us?"],
  resources: [
    { kind: "linkedin", text: "headline" },
    { kind: "cover_letter", text: "Dear team" },
    { kind: "company", text: "Acme is a fintech" },
    { kind: "notes", text: "remember to breathe" },
  ],
};

test("migrate turns flat settings into one candidate and one job, materials split by kind", () => {
  const p = migrate(flat);
  assert.ok(isProfiles(p));
  assert.equal(Object.keys(p.candidates).length, 1);
  assert.equal(Object.keys(p.jobs).length, 1);
  const c = p.candidates[p.activeCandidate], j = p.jobs[p.activeJob];
  assert.equal(c.name, "Jane Doe");
  assert.equal(c.cvText, flat.cvText);
  assert.deepEqual(c.stories, flat.stories);
  assert.deepEqual(c.resources.map((r) => r.kind), ["linkedin", "notes"]);
  assert.equal(j.jobDescription, flat.jobDescription);
  assert.deepEqual(j.likelyQuestions, ["Why us?"]);
  assert.deepEqual(j.resources.map((r) => r.kind), ["cover_letter", "company"]);
});

test("flatten gives back exactly the flat shape the coach reads, candidate materials first", () => {
  const f = flatten(migrate(flat));
  assert.equal(f.candidateName, "Jane Doe");
  assert.equal(f.cvText, flat.cvText);
  assert.deepEqual(f.stories, flat.stories);
  assert.equal(f.jobDescription, flat.jobDescription);
  assert.deepEqual(f.likelyQuestions, ["Why us?"]);
  assert.deepEqual(f.resources.map((r) => r.kind), ["linkedin", "notes", "cover_letter", "company"]);
  // empty profiles flatten to empty fields, never undefined
  assert.deepEqual(flatten(emptyProfiles()), { candidateName: "", cvText: "", stories: [], jobTitle: "", jobDescription: "", likelyQuestions: [], resources: [] });
  assert.deepEqual(flatten(migrate({})).stories, []);
});

test("applyFlat writes only the given fields into the active profiles", () => {
  let p = migrate(flat);
  p = applyFlat(p, { cvText: "new cv" });
  assert.equal(flatten(p).cvText, "new cv");
  assert.equal(flatten(p).jobDescription, flat.jobDescription, "untouched field survives");
  p = applyFlat(p, { resources: [{ kind: "company", text: "only job material now" }] });
  assert.deepEqual(p.candidates[p.activeCandidate].resources, []);
  assert.equal(p.jobs[p.activeJob].resources[0].text, "only job material now");
  // on an empty store it creates one of each rather than dropping the write
  const fresh = applyFlat(emptyProfiles(), { candidateName: "Alex" });
  assert.equal(flatten(fresh).candidateName, "Alex");
});

test("one candidate serves many jobs: switching the job changes only job fields", () => {
  let p = migrate(flat);
  const { profiles: p2, id: j2 } = addJob(p, { title: "Controller at Northwind", jobDescription: "Lead the team" });
  p = p2;
  assert.equal(p.activeJob, j2, "new job becomes active");
  const f = flatten(p);
  assert.equal(f.cvText, flat.cvText, "same CV");
  assert.equal(f.jobDescription, "Lead the team");
  assert.deepEqual(f.resources.map((r) => r.kind), ["linkedin", "notes"], "new job has no materials yet");
  p = setActive(p, { job: "j-1" });
  assert.equal(flatten(p).jobDescription, flat.jobDescription);
  assert.throws(() => setActive(p, { job: "nope" }), /no job/);
});

test("duplicate copies content under a new id; remove hands the active slot on", () => {
  let p = migrate(flat);
  const { profiles: p2, id } = duplicateCandidate(p, "c-1");
  assert.equal(p2.candidates[id].name, "Jane Doe (copy)");
  assert.deepEqual(p2.candidates[id].stories, flat.stories);
  assert.equal(p2.activeCandidate, id);
  const p3 = removeCandidate(p2, id);
  assert.equal(p3.activeCandidate, "c-1");
  const p4 = removeCandidate(p3, "c-1");
  assert.equal(p4.activeCandidate, null);
  assert.deepEqual(flatten(p4).stories, []);
  const { profiles: p5 } = duplicateJob(p, "j-1");
  assert.equal(Object.keys(p5.jobs).length, 2);
  assert.equal(removeJob(p5, p5.activeJob).activeJob, "j-1");
});

test("ids never collide even after removals; labels fall back sensibly", () => {
  let p = emptyProfiles();
  p = addCandidate(p).profiles; p = addCandidate(p).profiles;
  p = removeCandidate(p, "c-1");
  const { id } = addCandidate(p);
  assert.equal(id, "c-3", "c-2 exists, so the next is c-3");
  assert.equal(newId("x", { "x-1": 1, "x-2": 1 }), "x-3");
  assert.equal(candidateLabel({ name: "  " }), "Unnamed candidate");
  assert.equal(jobLabel({ title: "", jobDescription: "Senior Accountant, Acme\nmore" }), "Senior Accountant, Acme");
  assert.equal(jobLabel({}), "Untitled job");
  const q = updateJob(migrate(flat), "j-1", { title: "Named" });
  assert.equal(jobLabel(q.jobs["j-1"]), "Named");
});
