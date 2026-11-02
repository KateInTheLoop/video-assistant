import { careerTimeline, routeCareerHint } from "./careerTimeline.js";
import { experienceQuestion } from "./experienceTimeline.js";

export function experienceIntent(question = "", previous = null) {
  const direct = experienceQuestion(question);
  if (direct) return direct;
  if (previous?.question_type !== "topic_experience") return null;
  const followUp = question.trim().match(/^(?:and\s+)?(?:what about|how about|with|and with)\s+(.+?)[?.!]*$/i);
  if (!followUp) return null;
  const topic = followUp[1].replace(/[?.!]+$/, "").trim();
  if (/\b(?:what(?:'s|\s+(?:is|are))|how\s+(?:does|do)|explain|define|difference\s+between)\b/i.test(topic)) return null;
  return topic && topic.length <= 100 ? { topic, asksDuration: previous.experience_asks_duration === true } : null;
}

// Specific experience intent precedes the broad whole-career detector. Personal-story
// questions ('tell me about a time…') stay in the existing behavioral route.
export function routeQuestionHint(hint, question, previous = null) {
  if (!hint) return hint;
  if (/\b(?:tell\s+(?:me|us)\s+about|describe|give\s+(?:me|us))\s+(?:an?\s+)?(?:time|occasion|example)\b/i.test(question)) {
    return { ...hint, question_type: "behavioral", experience_topic: "", experience_outline: [], experience_evidence: [] };
  }
  const intent = experienceIntent(question, previous);
  const native = hint.is_question && hint.question_type === "topic_experience" && typeof hint.experience_topic === "string" && hint.experience_topic.trim();
  if (!intent && !native) return routeCareerHint(hint, question);
  return { ...hint, is_question: true, question_type: "topic_experience",
    experience_topic: intent?.topic || hint.experience_topic.trim(),
    experience_asks_duration: intent?.asksDuration || /\b(?:years|how long)\b/i.test(question),
    career_key: `${question}::${intent?.topic || hint.experience_topic.trim()}`,
    career_overview: [], technical_points: [], cv_leads: [] };
}

// Only the tier-filtered CV reaches this function. Do not send a hidden local CV to the
// model just to resolve role IDs; the local timeline can still work in Lean mode.
export function indexedRolesText(cvText = "") {
  return careerTimeline(cvText).map((role, i) => `Role ${i + 1}: ${role.title} | ${role.employer} | ${role.dates}`).join("\n") || "(no dated role index supplied)";
}
