import { test } from "node:test";
import assert from "node:assert/strict";
import { validateHint, HINT_SCHEMA } from "../lib/hintSchema.js";

const bank = ["Billing migration", "Team lead at Acme"];
const good = { is_question: true, question_summary: "Time you handled conflict", question_type: "behavioral",
  stories: [{ title: "Team lead at Acme", cue: "the designer disagreement" }], keywords: ["listen first", "data", "compromise"], watch_out: "" };

test("accepts a well-formed hint", () => {
  const r = validateHint(good, bank);
  assert.equal(r.ok, true); assert.deepEqual(r.errors, []); assert.equal(r.hint.keywords.length, 3);
});

test("drops sentences disguised as keywords", () => {
  const r = validateHint({ ...good, keywords: ["Say that you listened to everyone first.", "data", "I would compromise"] }, bank);
  assert.deepEqual(r.hint.keywords, ["data"]);
  assert.equal(r.errors.length, 2);
});

test("drops stories not in the bank", () => {
  const r = validateHint({ ...good, stories: [{ title: "Invented heroics", cue: "x" }, { title: "billing migration", cue: "y" }] }, bank);
  assert.deepEqual(r.hint.stories.map((s) => s.title), ["billing migration"]);
});

test("caps counts", () => {
  const r = validateHint({ ...good, keywords: ["a", "b", "c", "d", "e", "f"], stories: [
    { title: "Billing migration", cue: "1" }, { title: "Team lead at Acme", cue: "2" }, { title: "Billing migration", cue: "3" }] }, bank);
  assert.equal(r.hint.keywords.length, 4); assert.equal(r.hint.stories.length, 2);
});

test("rejects wrong shape", () => {
  assert.equal(validateHint({ is_question: "yes" }, bank).ok, false);
  assert.equal(validateHint(null, bank).ok, false);
});

test("schema requires every field and forbids extras", () => {
  assert.equal(HINT_SCHEMA.additionalProperties, false);
  assert.deepEqual(HINT_SCHEMA.required.sort(), Object.keys(HINT_SCHEMA.properties).sort());
});
