// Decides when interviewer speech should trigger a hint request.
// Pure function so it can be unit tested without a browser.
export const MIN_WORDS = 3;
export const PAUSE_DELAY_MS = 900;

const FILLERS = /^(mm+-?hm+|uh-?huh|okay|ok|right|yeah|yes|sure|great|cool|got it|i see|interesting)[.!,]?$/i;

export function shouldAskForHint({ text, speechFinal = false, pendingText = "" }) {
  const combined = `${pendingText} ${text}`.trim();
  const words = combined.split(/\s+/).filter(Boolean);
  if (words.length < MIN_WORDS || FILLERS.test(combined)) return { ask: false, delayMs: 0 };
  if (/\?\s*$/.test(text)) return { ask: true, delayMs: 0 };
  if (speechFinal) return { ask: true, delayMs: 0 };
  return { ask: true, delayMs: PAUSE_DELAY_MS };
}
