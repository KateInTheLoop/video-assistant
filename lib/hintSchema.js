// The hint shape is the honesty boundary: keywords only, stories only from the candidate's own bank.
export const MAX_KEYWORDS = 6;
export const MAX_KEYWORD_WORDS = 3;
export const MAX_STORIES = 3;
export const MAX_BEATS = 3;        // per story: the beats of the candidate's own story, from the bank text
export const MAX_BEAT_WORDS = 7;
export const MAX_CV_LEADS = 3;     // CV items that fit when no story does
export const MAX_CV_LEAD_WORDS = 8;
export const MAX_SHAPE = 5;
export const MAX_SHAPE_WORDS = 9;
export const MAX_FOLLOW_UPS = 3;
export const MAX_FOLLOW_UP_WORDS = 14;
export const QUESTION_TYPES = ["behavioral", "technical", "situational", "motivation", "experience", "logistics", "smalltalk", "none"];

export const HINT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["is_question", "follow_up", "question_summary", "question_type", "stories", "keywords", "watch_out", "answer_shape", "follow_ups", "cv_leads"],
  properties: {
    is_question: { type: "boolean", description: "True if the interviewer just asked something the candidate needs to answer." },
    follow_up: { type: "boolean", description: "True if this digs deeper into the answer the candidate just gave (e.g. 'and what did you learn?'). Then keep the same story." },
    question_summary: { type: "string", description: "The question restated in under 12 words. Empty if not a question." },
    question_type: { type: "string", enum: QUESTION_TYPES },
    stories: {
      type: "array",
      items: {
        type: "object", additionalProperties: false, required: ["title", "cue", "beats"],
        properties: {
          title: { type: "string", description: "Exact title of a story from the story bank." },
          cue: { type: "string", description: "One short phrase saying why THIS story fits THIS question, max 12 words." },
          beats: { type: "array", items: { type: "string" }, description: "Up to 3 beats of the story to hit for this question, taken from the story's own Situation/Action/Result text. Labels of max 7 words, not sentences, no first person." },
        },
      },
    },
    keywords: { type: "array", items: { type: "string" }, description: `Keywords only, 1-${MAX_KEYWORD_WORDS} words each. Never a sentence.` },
    watch_out: { type: "string", description: "One short caution, e.g. 'they asked for a failure, not a success'. Empty if none." },
    answer_shape: {
      type: "array",
      items: { type: "string" },
      description: `${MAX_SHAPE} or fewer prompts naming WHAT a strong answer covers, e.g. "Scope: which entities, what volume" or "Numbers: accounts, days to close". Labels, not words to read aloud: no first person, no full sentences, max ${MAX_SHAPE_WORDS} words each. Empty if not a question.`,
    },
    follow_ups: {
      type: "array",
      items: { type: "string" },
      description: `Up to ${MAX_FOLLOW_UPS} follow-up questions this answer is likely to invite, so the candidate can see the next beat coming. Max ${MAX_FOLLOW_UP_WORDS} words each. Empty if not a question.`,
    },
    cv_leads: {
      type: "array",
      items: { type: "string" },
      description: `Up to ${MAX_CV_LEADS} items FROM THE CV OR MATERIALS that fit this question but have no story in the bank (role, project, system, number). Max ${MAX_CV_LEAD_WORDS} words each, as written in the CV; never invented. Empty when the stories already cover the question or there is no CV.`,
    },
  },
};

// A keyword is a cue, not a line to read aloud: short, no sentence punctuation anywhere,
// no first/second-person phrasing, no imperative "say/tell/mention…" openers.
const PERSON_RE = /^(i|i'd|i'll|i'm|i've|we|we'd|we're|my|our|you|you'd|you're|your)\b/i;
const FIRST_PERSON_RE = /\b(i|i'd|i'll|i'm|i've|we|we'd|we'll|we're|we've|my|our|ours)\b/i;
const IMPERATIVE_RE = /^(say|tell|mention|explain|describe|start|answer|talk|respond|emphasi[sz]e|highlight)\b/i;
export function isKeyword(k) {
  if (typeof k !== "string") return false;
  const t = k.trim();
  if (!t || t.length > 40) return false;
  if (t.split(/\s+/).length > MAX_KEYWORD_WORDS) return false;
  if (/[.!?;:,]/.test(t)) return false;
  if (PERSON_RE.test(t) || IMPERATIVE_RE.test(t)) return false;
  return true;
}

// An answer-shape prompt names what to cover. It must not be sayable as an answer:
// no first person, no sentence punctuation, short.
export function isShapePrompt(s) {
  if (typeof s !== "string") return false;
  const t = s.trim();
  if (!t || t.length > 70) return false;
  if (t.split(/\s+/).length > MAX_SHAPE_WORDS) return false;
  if (FIRST_PERSON_RE.test(t)) return false;
  if (/[.!?]/.test(t)) return false;
  return true;
}

// A follow-up is the interviewer's next question, so it may be a full question;
// it still may not be phrased as the candidate's own words.
// A story beat or CV lead is a label too: short, no first person, not a sentence.
function isLabel(t, maxWords) {
  if (typeof t !== "string") return false;
  t = t.trim();
  if (!t || /[.!?]/.test(t)) return false;
  if (FIRST_PERSON_RE.test(t)) return false;
  return t.split(/\s+/).length <= maxWords;
}
export const isBeat = (t) => isLabel(t, MAX_BEAT_WORDS);
export const isCvLead = (t) => isLabel(t, MAX_CV_LEAD_WORDS);

export function isFollowUpQuestion(s) {
  if (typeof s !== "string") return false;
  const t = s.trim();
  if (!t || t.length > 120) return false;
  if (t.split(/\s+/).length > MAX_FOLLOW_UP_WORDS) return false;
  if (FIRST_PERSON_RE.test(t)) return false;
  return true;
}

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
    .map((s) => ({
      title: s.title.trim(),
      cue: s.cue.split(/\s+/).slice(0, 12).join(" "),
      beats: (Array.isArray(s.beats) ? s.beats : []).filter((b) => typeof b === "string").map((b) => b.trim())
        .filter((b) => { const ok = isBeat(b); if (!ok) errors.push(`rejected beat: ${b}`); return ok; }).slice(0, MAX_BEATS),
    }))
    .slice(0, MAX_STORIES);

  const cv_leads = (Array.isArray(obj.cv_leads) ? obj.cv_leads : [])
    .filter((x) => typeof x === "string")
    .map((x) => x.trim())
    .filter((x) => { const ok = isCvLead(x); if (!ok) errors.push(`rejected cv_lead: ${x}`); return ok; })
    .slice(0, MAX_CV_LEADS);

  const keywords = obj.keywords
    .filter((k) => typeof k === "string")
    .map((k) => k.trim())
    .filter((k) => { const ok = isKeyword(k); if (!ok) errors.push(`rejected keyword: ${k}`); return ok; })
    .slice(0, MAX_KEYWORDS);

  const answer_shape = (Array.isArray(obj.answer_shape) ? obj.answer_shape : [])
    .filter((x) => typeof x === "string")
    .map((x) => x.trim())
    .filter((x) => { const ok = isShapePrompt(x); if (!ok) errors.push(`rejected answer_shape: ${x}`); return ok; })
    .slice(0, MAX_SHAPE);

  const follow_ups = (Array.isArray(obj.follow_ups) ? obj.follow_ups : [])
    .filter((x) => typeof x === "string")
    .map((x) => x.trim())
    .filter((x) => { const ok = isFollowUpQuestion(x); if (!ok) errors.push(`rejected follow_up: ${x}`); return ok; })
    .slice(0, MAX_FOLLOW_UPS);

  const summaryWords = obj.question_summary.trim().split(/\s+/).filter(Boolean);
  const question_summary = summaryWords.slice(0, 14).join(" ");

  return {
    ok: true,
    errors,
    hint: {
      is_question: obj.is_question, follow_up, question_summary, question_type: obj.question_type,
      stories, keywords, answer_shape, follow_ups, cv_leads,
      watch_out: String(obj.watch_out || "").slice(0, 120),
    },
  };
}
