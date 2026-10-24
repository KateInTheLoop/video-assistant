// Pure rules for the coach window's question queue, so they can be tested without a browser.

// The interviewer's speech reaches us in fragments ("so first, I wanted to understand…",
// "…walk me through your resume", "…accruals and reconciliations"). Each fragment produces a
// fresh hint that is really a sharper reading of the SAME question. Stacking them fills the
// queue with near-duplicates, so while the interviewer is still asking we replace the last
// entry instead of appending.
export const SUPERSEDE_MS = 20000;

export function shouldSupersede({ last, hint, now, lastCandidateAt = 0, supersedeMs = SUPERSEDE_MS }) {
  if (!last) return false;
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

// Newest first within three bands: live questions, then answered, then moved-on. Anything
// below the live band can be brought back with one click, so nothing is ever lost.
const BAND = { answered: 1, dismissed: 2 };
export function queueOrder(questions) {
  const newestFirst = [...questions].reverse();
  return [0, 1, 2].flatMap((b) => newestFirst.filter((q) => (BAND[q.status] || 0) === b));
}

export const LIVE = (q) => !(q.status in BAND);
