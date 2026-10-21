// Story bank import/export and likely-question normalisation.
export const BANK_VERSION = 1;
const FIELDS = ["title", "situation", "action", "result", "tags", "source", "interviewTag"];

export function exportBank(stories, likelyQuestions = []) {
  return JSON.stringify({ version: BANK_VERSION, exportedAt: new Date().toISOString(), stories, likelyQuestions }, null, 2);
}

// Accepts our export format or a bare array of stories. Throws on anything else.
export function importBank(json) {
  const data = typeof json === "string" ? JSON.parse(json) : json;
  const list = Array.isArray(data) ? data : data?.stories;
  if (!Array.isArray(list)) throw new Error("Not a story bank: expected an array of stories.");
  const stories = list
    .filter((s) => s && typeof s.title === "string" && s.title.trim())
    .map((s) => Object.fromEntries(FIELDS.filter((f) => s[f] !== undefined).map((f) => [f, String(s[f])])));
  const likelyQuestions = Array.isArray(data?.likelyQuestions) ? normalizeLikely(data.likelyQuestions) : [];
  return { stories, likelyQuestions };
}

// Likely questions used to be plain strings; now {q, story|null}.
export function normalizeLikely(list) {
  return list.map((x) => (typeof x === "string" ? { q: x, story: null } : { q: String(x.q || ""), story: x.story || null })).filter((x) => x.q);
}

// Merge imported stories into existing ones, skipping duplicate titles (case-insensitive).
export function mergeStories(existing, incoming) {
  const seen = new Set(existing.map((s) => s.title.trim().toLowerCase()));
  const added = incoming.filter((s) => !seen.has(s.title.trim().toLowerCase()));
  return { stories: [...existing, ...added], added: added.length, skipped: incoming.length - added.length };
}
