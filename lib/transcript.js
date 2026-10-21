// Pure transcript helpers, shared by the panel and the tests.
export const MERGE_WINDOW_MS = 4000;

// Appends a final STT line, merging it into the previous line when the same
// speaker continued within MERGE_WINDOW_MS. Mutates and returns `transcript`.
export function mergeFinal(transcript, { speaker, text }, now = Date.now()) {
  const last = transcript[transcript.length - 1];
  if (last && last.speaker === speaker && now - last.t < MERGE_WINDOW_MS) {
    last.text = `${last.text} ${text}`.trim();
    last.t = now;
  } else {
    transcript.push({ speaker, text: text.trim(), t: now });
  }
  return transcript;
}

// Last n lines rendered for the model prompt.
export function recent(transcript, n = 14) {
  return transcript.slice(-n).map((l) => `${l.speaker.toUpperCase()}: ${l.text}`).join("\n");
}
