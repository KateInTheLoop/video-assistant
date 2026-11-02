// Pure rules for the coach window's question queue, so they can be tested without a browser.

// The interviewer's speech reaches us in fragments ("so first, I wanted to understand…",
// "…walk me through your resume", "…accruals and reconciliations"). Each fragment produces a
// fresh hint that is really a sharper reading of the SAME question. Stacking them fills the
// queue with near-duplicates, so while the interviewer is still asking we replace the last
// entry instead of appending.
export const SUPERSEDE_MS = 20000;

export function shouldSupersede({ last, hint, now, lastCandidateAt = 0, supersedeMs = SUPERSEDE_MS }) {
  if (!last) return false;
  if (last.explicit) return false;                // a user's capture is never rewritten by automatic detection
  if (last.hint?.question_type === "topic_experience" || hint.question_type === "topic_experience") {
    if (last.hint?.question_type !== hint.question_type || last.hint?.experience_topic?.trim().toLowerCase() !== hint.experience_topic?.trim().toLowerCase()) return false;
  }
  if (last.status !== "new") return false;        // candidate already triaged it: keep it
  if (hint.follow_up) return false;               // a genuine follow-up is its own question
  if (now - last.at >= supersedeMs) return false; // too long ago to be the same question
  if (lastCandidateAt >= last.at) return false;   // candidate answered: next question is new
  return true;
}

// "Answering" is a promise the candidate made by clicking; it should settle by itself once
// they have actually spoken and the interviewer has moved to the next question. Called when a
// genuinely new question is added. Returns the questions that flipped to "answered".
export function settleAnswering(questions, { lastCandidateAt = 0 } = {}) {
  const done = questions.filter((q) => q.status === "answering" && lastCandidateAt > q.at);
  for (const q of done) q.status = "answered";
  return done;
}

// Newest first within four bands: active, postponed, answered, then skipped. Anything
// below the live band can be brought back with one click, so nothing is ever lost.
const BAND = { later: 1, answered: 2, dismissed: 3 };
export function queueOrder(questions) {
  const newestFirst = [...questions].reverse();
  return [0, 1, 2, 3].flatMap((b) => newestFirst.filter((q) => (BAND[q.status] || 0) === b));
}

export const LIVE = (q) => !["answered", "dismissed"].includes(q.status);
