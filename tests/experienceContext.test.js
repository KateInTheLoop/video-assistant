import { test } from "node:test";
import assert from "node:assert/strict";
import { routeQuestionHint, experienceIntent } from "../lib/experienceContext.js";
import { buildHintRequest, buildPrewarmRequest, lastHintText } from "../lib/hintRequest.js";
import { validateHint, hasStoryGap } from "../lib/hintSchema.js";
import { shouldSupersede } from "../lib/questionQueue.js";

const cvText = "PROFESSIONAL EXPERIENCE\nAnalyst January 2019 - December 2020\nExample Co\n- Used SQL for reports\nEngineer January 2021 - December 2022\nExample Ltd\n- Maintained reporting checks";
const base = { is_question: true, question_type: "experience", question_summary: "Experience", stories: [], keywords: [] };

test("topic intent overrides whole-career routing and keeps incident questions behavioral", () => {
  const routed = routeQuestionHint(base, "Walk me through your work experience with SQL");
  assert.equal(routed.question_type, "topic_experience");
  assert.equal(routed.experience_topic, "SQL");
  assert.equal(hasStoryGap(routed), false);
  const incident = routeQuestionHint({ ...routed }, "Tell me about a time you used SQL");
  assert.equal(incident.question_type, "behavioral");
  assert.equal(incident.experience_topic, "");
});

test("terse topic follow-ups inherit duration context without turning definitions into personal experience", () => {
  const previous = routeQuestionHint(base, "How many years of experience do you have with SQL?");
  assert.equal(previous.experience_asks_duration, true);
  assert.deepEqual(experienceIntent("And with Workday?", previous), { topic: "Workday", asksDuration: true });
  assert.equal(experienceIntent("What is SQL?", previous), null);
  assert.equal(experienceIntent("And with SQL, what is an inner join?", previous), null);
  const definition = routeQuestionHint({ ...base, question_type: "technical", technical_points: ["An inner join returns matching rows"] }, "And with SQL, what is an inner join?", previous);
  assert.equal(definition.question_type, "technical");
  assert.equal(definition.technical_points.length, 1);
  assert.equal(experienceIntent("And with Workday?"), null);
  assert.match(lastHintText({ ...previous, experience_outline: ["Reporting checks"], keywords: [] }), /topic: SQL; duration requested: yes/);
});

test("role index obeys CV tier and topic outputs have sufficient budget without changing the cache prefix", () => {
  const ctx = { model: "example", cvText, stories: [], transcript: [{ speaker: "interviewer", text: "Tell me about your experience with SQL?" }] };
  const full = buildHintRequest(ctx), lean = buildHintRequest({ ...ctx, tier: "lean" });
  assert.match(full.system.at(-1).text, /Role 1: Analyst/);
  assert.doesNotMatch(lean.system.at(-1).text, /Example Co|2019|Used SQL/);
  assert.match(lean.system.at(-1).text, /no dated role index supplied/);
  assert.ok(full.max_tokens > buildHintRequest({ ...ctx, transcript: [{ speaker: "interviewer", text: "What is SQL?" }] }).max_tokens);
  assert.deepEqual(buildPrewarmRequest(ctx).system, full.system);
});

test("validation preserves many role references, drops invented stories and model duration claims", () => {
  const raw = { ...base, question_type: "topic_experience", experience_topic: "SQL", experience_outline: ["Month-end close support", "Year-end audit preparation", "5+ yrs of closing expertise", "Ten years of SQL expertise"],
    experience_evidence: Array.from({ length: 5 }, (_, i) => ({ role: i + 1, quote: "SQL reporting", story: i ? "Invented story" : "Reporting checks" })) };
  const { hint } = validateHint(raw, ["Reporting checks"]);
  assert.equal(hint.experience_evidence.length, 5);
  assert.equal(hint.experience_evidence[0].story, "Reporting checks");
  assert.equal(hint.experience_evidence[1].story, null);
  assert.deepEqual(hint.experience_outline, ["Month-end close support", "Year-end audit preparation"]);
  const last = { at: 1000, status: "new", hint };
  assert.equal(shouldSupersede({ last, hint: { ...hint, experience_topic: "Workday" }, now: 2000 }), false);
  assert.equal(shouldSupersede({ last, hint, now: 2000 }), true);
});
