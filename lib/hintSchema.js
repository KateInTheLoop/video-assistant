// The hint shape is the honesty boundary: keywords only, stories only from the candidate's own bank.
export const MAX_KEYWORDS = 4;
export const MAX_KEYWORD_WORDS = 3;
export const MAX_STORIES = 2;
export const QUESTION_TYPES = ["behavioral", "technical", "situational", "motivation", "experience", "logistics", "smalltalk", "none"];

export const HINT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["is_question", "follow_up", "question_summary", "question_type", "stories", "keywords", "watch_out"],
  properties: {
    is_question: { type: "boolean", description: "True if the interviewer just asked something the candidate needs to answer." },
    follow_up: { type: "boolean", description: "True if this digs deeper into the answer the candidate just gave (e.g. 'and what did you learn?'). Then keep the same story." },
    question_summary: { type: "string", description: "The question restated in under 12 words. Empty if not a question." },
    question_type: { type: "string", enum: QUESTION_TYPES },
    stories: {
      type: "array", maxItems: MAX_STORIES,
      items: {
        type: "object", additionalProperties: false, required: ["title", "cue"],
        properties: {
          title: { type: "string", description: "Exact title of a story from the story bank." },
          cue: { type: "string", description: "One short phrase reminding the candidate of the key beat, max 10 words." },
        },
      },
    },
    keywords: { type: "array", maxItems: MAX_KEYWORDS, items: { type: "string" }, description: `Keywords only, 1-${MAX_KEYWORD_WORDS} words each. Never a sentence.` },
    watch_out: { type: "string", description: "One short caution, e.g. 'they asked for a failure, not a success'. Empty if none." },
  },
};

// Returns {ok, errors, hint} where hint is a sanitised copy (bad keywords/stories dropped).
// Rejects outright only when the shape is wrong; otherwise filters so a mostly-good hint still shows.
export function validateHint(obj, storyTitles = []) {
  const errors = [];
  if (!obj || typeof obj !== "object") return { ok: false, errors: ["not an object"], hint: null };
  if (typeof obj.is_question !== "boolean") errors.push("is_question missing");
  const follow_up = obj.follow_up === true;
  if (typeof obj.question_summary !== "string") errors.push("question_summary missing");
  if (!QUESTION_TYPES.includes(obj.question_type)) errors.push("bad question_type");
  if (!Array.isArray(obj.keywords) || !Array.isArray(obj.stories)) errors.push("keywords/stories not arrays");
  if (errors.length) return { ok: false, errors, hint: null };

  const titles = new Set(storyTitles.map((t) => t.trim().toLowerCase()));
  const stories = obj.stories
    .filter((s) => s && typeof s.title === "string" && typeof s.cue === "string")
    .filter((s) => { const known = titles.has(s.title.trim().toLowerCase()); if (!known) errors.push(`unknown story: ${s.title}`); return known; })
    .map((s) => ({ title: s.title.trim(), cue: s.cue.split(/\s+/).slice(0, 10).join(" ") }))
    .slice(0, MAX_STORIES);

  const keywords = obj.keywords
    .filter((k) => typeof k === "string")
    .map((k) => k.trim())
    .filter((k) => {
      // Short enough, no sentence punctuation, and not a first-person phrase ("I would…") the candidate could read aloud.
      const ok = k.length > 0 && k.split(/\s+/).length <= MAX_KEYWORD_WORDS && !/[.!?]$/.test(k) && !/^(i|i'd|i'll|i'm|we|we'd|my|our)\b/i.test(k);
      if (!ok) errors.push(`rejected keyword: ${k}`);
      return ok;
    })
    .slice(0, MAX_KEYWORDS);

  const summaryWords = obj.question_summary.trim().split(/\s+/).filter(Boolean);
  const question_summary = summaryWords.slice(0, 14).join(" ");

  return {
    ok: true,
    errors,
    hint: { is_question: obj.is_question, follow_up, question_summary, question_type: obj.question_type, stories, keywords, watch_out: String(obj.watch_out || "").slice(0, 120) },
  };
}
