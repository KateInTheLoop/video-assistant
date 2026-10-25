import { test } from "node:test";
import assert from "node:assert/strict";
import { parsePartialJson } from "../lib/partialJson.js";
import { provisionalHint, HINT_SCHEMA } from "../lib/hintSchema.js";

const full = JSON.stringify({ is_question: true, follow_up: false, question_summary: "Tell me about a migration", question_type: "behavioral",
  stories: [{ title: "Billing migration", cue: "fits: a migration", beats: ["Two ERPs", "Close 9 to 5 days"] }], keywords: ["scope", "defects"], cv_leads: ["$1.2M ARR"], watch_out: "", answer_shape: ["Scope: entities"], follow_ups: ["What broke?"] });

test("every prefix of a valid JSON document parses to null or a sane partial object", () => {
  let last = null;
  for (let i = 1; i <= full.length; i++) {
    const p = parsePartialJson(full.slice(0, i));
    if (p !== null) { assert.equal(typeof p, "object"); last = p; }
  }
  assert.deepEqual(last, JSON.parse(full));
});

test("partials expose completed fields and never half a key", () => {
  const p = parsePartialJson('{"is_question": true, "follow_up": false, "question_summary": "Tell me abo');
  assert.deepEqual(p, { is_question: true, follow_up: false, question_summary: "Tell me abo" });
  const q = parsePartialJson('{"is_question": true, "stories": [{"title": "Billing migration", "cue": "x"}, {"title": "Te');
  assert.deepEqual(q.stories, [{ title: "Billing migration", cue: "x" }, { title: "Te" }]);
  assert.deepEqual(parsePartialJson('{"is_question": true, "quest'), { is_question: true });
  assert.deepEqual(parsePartialJson('{"is_question": true, "question_summary":'), { is_question: true });
  assert.equal(parsePartialJson(""), null);
});

test("provisional hint appears once is_question and a summary exist, validated like a final one", () => {
  const bank = ["Billing migration"];
  assert.equal(provisionalHint({ is_question: true }, bank), null);
  assert.equal(provisionalHint({ is_question: false, question_summary: "x" }, bank), null);
  const h = provisionalHint({ is_question: true, question_summary: "Tell me about a migration", stories: [{ title: "Billing migration", cue: "fits" }, { title: "Inven" }] }, bank);
  assert.equal(h.question_summary, "Tell me about a migration");
  assert.deepEqual(h.stories.map((s) => s.title), ["Billing migration"]);
  assert.deepEqual(h.keywords, []); assert.deepEqual(h.answer_shape, []);
  assert.equal(h.question_type, "behavioral");
});

test("schema order puts cv_leads before the collapsed answer-shape section so they stream earlier", () => {
  const keys = Object.keys(HINT_SCHEMA.properties);
  assert.ok(keys.indexOf("cv_leads") < keys.indexOf("answer_shape"));
  assert.ok(keys.indexOf("stories") < keys.indexOf("cv_leads"));
  assert.deepEqual([...keys].sort(), [...HINT_SCHEMA.required].sort());
});
