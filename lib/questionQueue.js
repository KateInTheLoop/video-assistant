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

// Newest first, with dismissed questions sunk below the live ones so focus stays on what matters.
export function queueOrder(questions) {
  const newestFirst = [...questions].reverse();
  return [
    ...newestFirst.filter((q) => q.status !== "dismissed"),
    ...newestFirst.filter((q) => q.status === "dismissed"),
  ];
}
