import { test } from "node:test";
import assert from "node:assert/strict";
import { materialsText, sessionDigest, estimateTokens, applyTier, MAX_MATERIALS_CHARS } from "../lib/context.js";
import { buildHintRequest, contextReport } from "../lib/hintRequest.js";

const q = (summary, titles = [], is_question = true) => ({ hint: { is_question, question_summary: summary, stories: titles.map((t) => ({ title: t })) } });

test("materials are labelled by kind, empty ones dropped, order kept", () => {
  const out = materialsText([
    { kind: "linkedin", text: "  Senior accountant at Acme  " },
    { kind: "notes", text: "" },
    { kind: "cover_letter", text: "Dear team" },
    { kind: "mystery", text: "x" },
  ]);
  assert.equal(out, "## LinkedIn profile\nSenior accountant at Acme\n\n## Cover / motivation letter\nDear team\n\n## Other\nx");
  assert.equal(materialsText([]), "");
  assert.equal(materialsText([{ kind: "notes", text: "   " }]), "");
});

test("materials are capped with a marker", () => {
  const out = materialsText([{ kind: "other", text: "x".repeat(MAX_MATERIALS_CHARS + 1000) }]);
  assert.ok(out.length < MAX_MATERIALS_CHARS + 120);
  assert.match(out, /materials truncated/);
});

test("digest lists questions with the stories used; non-questions skipped; long sessions trimmed", () => {
  assert.equal(sessionDigest([]), "");
  assert.equal(sessionDigest([q("Tell me about yourself", ["Billing migration"]), q("small talk", [], false), q("A failure?")]),
    "1. Tell me about yourself → used: Billing migration\n2. A failure? → no story");
  const many = Array.from({ length: 15 }, (_, i) => q(`Q${i + 1}`));
  const d = sessionDigest(many, { max: 3 });
  assert.equal(d, "(12 earlier questions omitted)\n13. Q13 → no story\n14. Q14 → no story\n15. Q15 → no story");
});

test("token estimate is ~chars/4", () => {
  assert.equal(estimateTokens("a".repeat(400)), 100);
  assert.equal(estimateTokens(""), 0);
});

const ctx = { model: "claude-haiku-5-5", stories: [{ title: "A", situation: "s", action: "a", result: "r" }], jobDescription: "JD", cvText: "CV" };

test("materials live in the cached prefix with a 1h TTL; the digest lives in the user turn", () => {
  const resources = [{ kind: "company", text: "Acme is a fintech" }];
  const questions = [q("Walk me through your resume", ["A"])];
  const a = buildHintRequest({ ...ctx, transcript: [], resources, questions });
  const b = buildHintRequest({ ...ctx, transcript: [], resources, questions: [] });
  assert.deepEqual(a.system, b.system, "digest must not touch the prefix");
  assert.match(a.system.at(-1).text, /# Additional materials\n## Company research\nAcme is a fintech/);
  assert.deepEqual(a.system.at(-1).cache_control, { type: "ephemeral", ttl: "1h" });
  assert.match(a.messages[0].content, /Interview so far:\n1\. Walk me through your resume → used: A/);
  assert.match(b.messages[0].content, /Interview so far:\n\(first question\)/);
  assert.doesNotMatch(JSON.stringify(a.system), /Walk me through/);
});

test("context report breaks the prefix down and flags a prefix too small to cache", () => {
  const small = contextReport({ stories: [], cvText: "", jobDescription: "", resources: [] });
  assert.ok(small.parts.some((p) => p.label === "Instructions" && p.tokens > 0));
  assert.equal(small.parts.find((p) => p.label === "CV").tokens, 0);
  const big = contextReport({ stories: ctx.stories, cvText: "c".repeat(6000), jobDescription: "j".repeat(800), resources: [{ kind: "notes", text: "n".repeat(400) }] });
  assert.ok(big.total > small.total);
  assert.equal(big.parts.find((p) => p.label === "CV").tokens, 1500);
  assert.equal(big.parts.find((p) => p.label === "Additional materials").tokens > 0, true);
  assert.equal(typeof big.cacheable, "boolean");
  assert.equal(big.cacheable, big.total >= 512);
});

test("tiers decide what reaches the coach; unknown tier means everything", () => {
  const all = { stories: ctx.stories, jobDescription: "JD", cvText: "CV", resources: [{ kind: "notes", text: "n" }] };
  assert.deepEqual(applyTier(all, "lean"), { stories: ctx.stories, jobDescription: "JD", cvText: "", resources: [] });
  assert.deepEqual(applyTier(all, "standard"), { ...all, resources: [] });
  assert.deepEqual(applyTier(all, "full"), all);
  assert.deepEqual(applyTier(all, "bogus"), all);
});

test("the request and the report agree about the tier", () => {
  const resources = [{ kind: "linkedin", text: "profile text" }];
  const lean = buildHintRequest({ ...ctx, transcript: [], resources, tier: "lean" });
  assert.doesNotMatch(lean.system.at(-1).text, /profile text|# CV\nCV/);
  assert.match(lean.system.at(-1).text, /# CV\n\(none\)/);
  const full = buildHintRequest({ ...ctx, transcript: [], resources, tier: "full" });
  assert.match(full.system.at(-1).text, /profile text/);
  const rep = contextReport({ ...ctx, resources, tier: "lean" });
  assert.equal(rep.parts.find((p) => p.label === "CV").included, false);
  assert.equal(rep.parts.find((p) => p.label === "CV").tokens, 0);
  assert.equal(rep.parts.find((p) => p.label === "Story bank").included, true);
});
