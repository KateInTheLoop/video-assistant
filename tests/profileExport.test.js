import { test } from "node:test";
import assert from "node:assert/strict";
import { exportProfile, importProfile, exportBank } from "../lib/bank.js";

const cand = { name: "Jane Doe", cvText: "cv", stories: [{ title: "Billing migration", situation: "s", action: "a", result: "r", tags: "impact" }], resources: [{ kind: "linkedin", text: "h" }], secret: "must not travel" };
const job = { title: "Senior Accountant, Acme", jobDescription: "jd", resources: [{ kind: "company", text: "c" }], likelyQuestions: [{ q: "Why us?", story: null }] };

test("a candidate or job round-trips through JSON with only its known fields", () => {
  const c = importProfile(exportProfile("candidate", cand));
  assert.equal(c.kind, "candidate");
  assert.deepEqual(Object.keys(c.data).sort(), ["cvText", "name", "resources", "stories"]);
  assert.deepEqual(c.data.stories, cand.stories);
  const j = importProfile(exportProfile("job", job));
  assert.equal(j.kind, "job");
  assert.deepEqual(j.data, job);
});

test("import rejects the wrong shapes with a message that says what to use instead", () => {
  assert.throws(() => importProfile(exportBank([{ title: "x" }])), /story bank/i);
  assert.throws(() => importProfile(JSON.stringify({ kind: "candidate" })), /not a candidate or job/i);
  assert.throws(() => importProfile(JSON.stringify({ kind: "pet", data: {} })), /not a candidate or job/i);
  assert.throws(() => importProfile("[]"), /story bank/i, "a bare array is the old bank format");
});
