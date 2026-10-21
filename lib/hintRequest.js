// Builds the Messages API body for a live hint. Pure, so tests can check that the
// stable candidate context stays in the cached prefix and only the transcript varies.
import { HINT_SCHEMA } from "./hintSchema.js";
import { recent } from "./transcript.js";

export const HINT_SYSTEM = `You are a quiet interview coach sitting next to a candidate during a live video interview.
You see the rolling transcript. The INTERVIEWER lines come from the call audio, the CANDIDATE lines from the candidate's microphone.

Your job is to reduce cognitive load, not to answer for the candidate:
- Tell them what was actually asked, in a few words.
- Point at which of THEIR OWN stories fit. Only use stories from the story bank, by exact title. Never invent experience.
- Give at most four keywords to structure the answer. Keywords, never sentences. The candidate must speak in their own words.
- Flag a trap if there is one (multi-part question, asked for a failure, asked for numbers).
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

export function buildHintRequest({ model, transcript, stories = [], jobDescription = "", cvText = "", lastHint = null }) {
  return {
    model,
    max_tokens: 1024,
    output_config: { effort: "low", format: { type: "json_schema", schema: HINT_SCHEMA } },
    fallbacks: "default",
    system: [
      { type: "text", text: HINT_SYSTEM },
      // Everything above and including this block is stable for the whole interview, so it is cached.
      { type: "text", text: `# Story bank\n${storyBankText(stories)}\n\n# Job description\n${jobDescription || "(none)"}\n\n# CV\n${cvText || "(none)"}`, cache_control: { type: "ephemeral" } },
    ],
    messages: [{ role: "user", content: `Previous hint shown to the candidate: ${lastHintText(lastHint)}\n\nRolling transcript (most recent last):\n\n${recent(transcript, 14)}\n\nProduce the hint for the interviewer's latest utterance.` }],
  };
}
