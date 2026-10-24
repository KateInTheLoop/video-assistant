// Builds the Messages API body for a live hint. Pure, so tests can check that the
// stable candidate context stays in the cached prefix and only the transcript varies.
import { HINT_SCHEMA } from "./hintSchema.js";
import { recent } from "./transcript.js";
import { materialsText, sessionDigest, estimateTokens, applyTier, tierIncludes, CACHE_MIN_TOKENS } from "./context.js";

export const HINT_SYSTEM = `You are a quiet interview coach sitting next to a candidate during a live video interview.
You see the rolling transcript. The INTERVIEWER lines come from the call audio, the CANDIDATE lines from the candidate's microphone.

Your job is to reduce cognitive load, not to answer for the candidate:
- Tell them what was actually asked, in a few words.
- Point at which of THEIR OWN stories fit. Only use stories from the story bank, by exact title. Never invent experience.
- Give at most four keywords to structure the answer. A keyword is 1-3 words, no punctuation, no "I/you/we", no "say/mention/explain". Never a sentence or a phrase that could be read aloud. The candidate must speak in their own words.
- Flag a trap if there is one (multi-part question, asked for a failure, asked for numbers).
- Give up to five answer_shape prompts: what a strong answer to THIS question covers (scope, their role, a specific instance, numbers, what changed). These name what to cover; they are never words to read aloud, so no first person and no full sentences.
- Give up to three follow_ups: the questions this answer is most likely to invite, so the candidate sees the next beat coming.
- Additional materials (cover letter, LinkedIn profile, company research, the candidate's notes) are background: use them for motivation and logistics questions and to tailor cues to this company. They never add stories; only story-bank titles may be named as stories.
- "Interview so far" lists what was already asked and which stories were used. Prefer a story not yet used unless it is clearly the best fit; if they would be repeating one, say so in watch_out.
- If the previous hint is given and the new question digs into the same answer ("and what did you learn?", "why that approach?"), set follow_up=true and keep the same story; keywords should then point at the next beat of that story.

If the interviewer's latest utterance is not a question (small talk, explaining the role, still mid-sentence), set is_question=false and leave the rest minimal.
Be fast and terse. Respond only with the JSON object.`;

export function storyBankText(stories) {
  return stories.length
    ? stories.map((s) => `### ${s.title}\nTags: ${s.tags || ""}\nSituation: ${s.situation}\nAction: ${s.action}\nResult: ${s.result}`).join("\n\n")
    : "(empty)";
}

export function lastHintText(lastHint) {
  if (!lastHint || !lastHint.is_question) return "(none)";
  const stories = lastHint.stories.map((s) => s.title).join(", ") || "none";
  return `${lastHint.question_summary} [${lastHint.question_type}] → stories: ${stories}; keywords: ${lastHint.keywords.join(", ")}`;
}

// The stable half of the prompt: identical for the whole interview, so it is cached once.
export function contextBlockText({ stories = [], jobDescription = "", cvText = "", resources = [] }) {
  return `# Story bank\n${storyBankText(stories)}\n\n# Job description\n${jobDescription || "(none)"}\n\n# CV\n${cvText || "(none)"}\n\n# Additional materials\n${materialsText(resources) || "(none)"}`;
}

// What the coach sees, by component, so Settings can show it. Estimates; the API count is exact.
export function contextReport({ stories = [], jobDescription = "", cvText = "", resources = [], tier } = {}) {
  const inc = tierIncludes(tier);
  const sent = applyTier({ stories, jobDescription, cvText, resources }, tier);
  const parts = [
    { label: "Instructions", tokens: estimateTokens(HINT_SYSTEM), included: true },
    { label: "Story bank", tokens: estimateTokens(storyBankText(sent.stories)), count: stories.length, included: inc.stories },
    { label: "Job description", tokens: estimateTokens(sent.jobDescription), included: inc.jobDescription },
    { label: "CV", tokens: estimateTokens(sent.cvText), included: inc.cvText },
    { label: "Additional materials", tokens: estimateTokens(materialsText(sent.resources)), count: resources.filter((r) => r?.text?.trim()).length, included: inc.resources },
  ];
  const total = parts.reduce((n, p) => n + p.tokens, 0);
  return { parts, total, cacheable: total >= CACHE_MIN_TOKENS, cacheMin: CACHE_MIN_TOKENS };
}

export function buildHintRequest({ model, transcript, stories = [], jobDescription = "", cvText = "", resources = [], questions = [], lastHint = null, tier }) {
  ({ stories, jobDescription, cvText, resources } = applyTier({ stories, jobDescription, cvText, resources }, tier));
  return {
    model,
    max_tokens: 1024,
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
