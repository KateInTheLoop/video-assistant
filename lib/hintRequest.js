// Builds the Messages API body for a live hint. Pure, so tests can check that the
// stable candidate context stays in the cached prefix and only the transcript varies.
import { HINT_SCHEMA } from "./hintSchema.js";
import { recent } from "./transcript.js";
import { materialsText, materialPlan, sessionDigest, estimateTokens, applyTier, tierIncludes, CACHE_MIN_TOKENS } from "./context.js";
import { INTERVIEW_SKILL } from "./interviewSkill.js";
import { indexedRolesText, experienceIntent } from "./experienceContext.js";

export const HINT_SYSTEM = `${INTERVIEW_SKILL}

# Application response contract
Return only the JSON object matching the supplied schema. Keep unrelated fields empty.
Use technical_points for technical explanations, career_overview for whole-career opening cues,
and experience_topic, experience_outline and experience_evidence for topic-specific personal experience.
Evidence role IDs refer only to the supplied dated CV index; evidence quotes must be exact substrings
of that role's title or duties. Keep evidence short, oldest first, and leave dates/arithmetic to the app.
Keywords and answer-shape cues are brief labels, not first-person scripts. Story titles must match
provided bank entries exactly. The interviewer's latest request decides the mode, not the topic
predicted in candidate notes. Never fabricate experience to satisfy a priority.`;

export function storyBankText(stories) {
  return stories.length
    ? stories.map((s) => `### ${s.title}\nTags: ${s.tags || ""}\nSituation: ${s.situation}\nAction: ${s.action}\nResult: ${s.result}`).join("\n\n")
    : "(empty)";
}

export function lastHintText(lastHint) {
  if (!lastHint || !lastHint.is_question) return "(none)";
  const stories = lastHint.stories.map((s) => s.title).join(", ") || "none";
  const topic = lastHint.question_type === "topic_experience" ? `; topic: ${lastHint.experience_topic || "unknown"}; duration requested: ${lastHint.experience_asks_duration ? "yes" : "no"}; storyline: ${(lastHint.experience_outline || []).join(" → ")}` : "";
  return `${lastHint.question_summary} [${lastHint.question_type}] → stories: ${stories}; keywords: ${lastHint.keywords.join(", ")}${topic}`;
}

// The stable half of the prompt: identical for the whole interview, so it is cached once.
export function contextBlockText({ stories = [], jobDescription = "", cvText = "", resources = [] }) {
  return `# Candidate guidance and prioritized materials\n${materialsText(resources) || "(none)"}\n\n# Story bank\n${storyBankText(stories)}\n\n# Job description\n${jobDescription || "(none)"}\n\n# CV\n${cvText || "(none)"}\n\n# Dated CV role index (reference IDs only; use exact quotes from the CV above)\n${indexedRolesText(cvText)}`;
}

// What the coach sees, by component, so Settings can show it. Estimates; the API count is exact.
export function contextReport({ stories = [], jobDescription = "", cvText = "", resources = [], tier } = {}) {
  const inc = tierIncludes(tier);
  const sent = applyTier({ stories, jobDescription, cvText, resources }, tier);
  const bank = storyBankText(sent.stories), plan = materialPlan(sent.resources), materials = plan.text;
  const roleIndex = sent.cvText ? indexedRolesText(sent.cvText) : "";
  const wrapperChars = contextBlockText(sent).length - bank.length - materials.length
    - sent.jobDescription.length - sent.cvText.length - roleIndex.length;
  const parts = [
    { label: "Instructions", tokens: estimateTokens(HINT_SYSTEM), included: true },
    { label: "Story bank", tokens: estimateTokens(bank), count: stories.length, included: inc.stories },
    { label: "Job description", tokens: estimateTokens(sent.jobDescription), included: inc.jobDescription },
    { label: "CV", tokens: estimateTokens(sent.cvText), included: inc.cvText },
    { label: "Additional materials", tokens: estimateTokens(materials), count: plan.entries.filter(e => ["included", "truncated"].includes(e.status)).length, included: inc.resources || sent.resources.some(r => ["notes", "resume_summary"].includes(r.kind)) },
    { label: "Dated CV role index", tokens: estimateTokens(roleIndex), included: inc.cvText },
    { label: "Headings and separators", tokens: Math.ceil(Math.max(0, wrapperChars) / 4), included: true },
    { label: "Response format", tokens: estimateTokens(JSON.stringify(HINT_SCHEMA)), included: true },
  ];
  const total = parts.reduce((n, p) => n + p.tokens, 0);
  return { parts, total, cacheable: total >= CACHE_MIN_TOKENS, cacheMin: CACHE_MIN_TOKENS };
}

export function buildHintRequest({ model, transcript, question, stories = [], jobDescription = "", cvText = "", resources = [], questions = [], lastHint = null, tier }) {
  ({ stories, jobDescription, cvText, resources } = applyTier({ stories, jobDescription, cvText, resources }, tier));
  return {
    model,
    max_tokens: experienceIntent(question || [...transcript].reverse().find(line => line.speaker === "interviewer")?.text || "", lastHint) ? 1536 : 1024,
    output_config: { effort: "low", format: { type: "json_schema", schema: HINT_SCHEMA } },
    fallbacks: "default",
    system: [
      { type: "text", text: HINT_SYSTEM },
      // Everything above and including this block is stable for the whole interview, so it is cached.
      // 1h TTL: hints are minutes apart (long answers), and a 5-minute entry would expire between them.
      { type: "text", text: contextBlockText({ stories, jobDescription, cvText, resources }), cache_control: { type: "ephemeral", ttl: "1h" } },
    ],
    messages: [{ role: "user", content: `Previous hint shown to the candidate: ${lastHintText(lastHint)}\n\nInterview so far:\n${sessionDigest(questions) || "(first question)"}\n\nRolling transcript (most recent last):\n\n${recent(transcript, 14)}\n\nProduce the hint for the interviewer's latest utterance.` }],
  };
}

// A one-token request with the exact same prefix (system blocks AND output_config: the schema
// is part of the cached prefix, ~1.2k tokens) so the first real hint of a session reads the
// cache instead of writing it. Measured: cold first hint 2.6-5.4 s, after prewarm 2.0 s.
export function buildPrewarmRequest(ctx) {
  const real = buildHintRequest({ ...ctx, transcript: [], questions: [], lastHint: null });
  return { ...real, max_tokens: 1, messages: [{ role: "user", content: "warm-up" }] };
}
