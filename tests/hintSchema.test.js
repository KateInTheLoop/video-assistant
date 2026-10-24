import { test } from "node:test";
import assert from "node:assert/strict";
import { validateHint, HINT_SCHEMA, isKeyword, isShapePrompt, isFollowUpQuestion } from "../lib/hintSchema.js";

const bank = ["Billing migration", "Team lead at Acme"];
const good = { is_question: true, follow_up: false, question_summary: "Time you handled conflict", question_type: "behavioral",
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

test("follow_up passes through and defaults to false", () => {
  assert.equal(validateHint({ ...good, follow_up: true }, bank).hint.follow_up, true);
  const { follow_up, ...noFlag } = good;
  assert.equal(validateHint(noFlag, bank).hint.follow_up, false);
});

test("isKeyword accepts cues and rejects readable lines", () => {
  for (const k of ["listen first", "data", "STAR", "2x throughput", "trade-offs"]) assert.equal(isKeyword(k), true, k);
  for (const k of ["Say you listened first", "you should mention data", "listen, then act", "Highlight the result", "I would compromise", "a b c d", "Explain: tradeoffs"]) assert.equal(isKeyword(k), false, k);
});

test("answer_shape prompts name what to cover, never words to say", () => {
  assert.equal(isShapePrompt("Scope: which entities, what volume"), true);
  assert.equal(isShapePrompt("Numbers: accounts, days to close"), true);
  assert.equal(isShapePrompt("I owned the month-end close"), false);   // first person = sayable
  assert.equal(isShapePrompt("We cut the close from 9 days to 5"), false);
  assert.equal(isShapePrompt("Talk about the reconciliation backlog."), false); // sentence
  assert.equal(isShapePrompt("a ".repeat(12)), false);                // too long
  assert.equal(isShapePrompt(""), false);
});

test("follow_ups may be questions but not the candidate's own words", () => {
  assert.equal(isFollowUpQuestion("Which ERP did you use?"), true);
  assert.equal(isFollowUpQuestion("Biggest reconciliation break you found?"), true);
  assert.equal(isFollowUpQuestion("I would say the ERP migration"), false);
  assert.equal(isFollowUpQuestion("x ".repeat(20)), false);
});

test("validateHint keeps good shape prompts and follow-ups, drops the rest", () => {
  const { ok, hint } = validateHint({
    is_question: true, follow_up: false, question_summary: "Walk me through your resume",
    question_type: "experience", stories: [], keywords: ["accruals"], watch_out: "",
    answer_shape: ["Scope: which entities", "I ran the close myself", "Numbers: days to close"],
    follow_ups: ["Which ERP?", "We also did SOX work", "How did you cut close time?"],
  }, []);
  assert.equal(ok, true);
  assert.deepEqual(hint.answer_shape, ["Scope: which entities", "Numbers: days to close"]);
  assert.deepEqual(hint.follow_ups, ["Which ERP?", "How did you cut close time?"]);
});

test("a hint missing the new fields still validates (empty arrays)", () => {
  const { ok, hint } = validateHint({
    is_question: true, follow_up: false, question_summary: "Tell me about yourself",
    question_type: "experience", stories: [], keywords: [], watch_out: "",
  }, []);
  assert.equal(ok, true);
  assert.deepEqual(hint.answer_shape, []);
  assert.deepEqual(hint.follow_ups, []);
});

test("the live schema has no maxItems/minItems anywhere (the API rejects them)", () => {
  const json = JSON.stringify(HINT_SCHEMA);
  assert.equal(/maxItems|minItems/.test(json), false);
});
