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

// --- Whole-profile transfer (one candidate or one job) -------------------------------
// Only the fields the profile model knows travel; anything else in the file is dropped.
export const PROFILE_FIELDS = {
  candidate: ["name", "cvText", "stories", "resources"],
  job: ["title", "jobDescription", "resources", "likelyQuestions"],
};

export function exportProfile(kind, data) {
  if (!PROFILE_FIELDS[kind]) throw new Error(`Unknown profile kind: ${kind}`);
  const picked = Object.fromEntries(PROFILE_FIELDS[kind].filter((f) => data?.[f] !== undefined).map((f) => [f, data[f]]));
  return JSON.stringify({ version: BANK_VERSION, kind, exportedAt: new Date().toISOString(), data: picked }, null, 2);
}

export function importProfile(json) {
  const parsed = typeof json === "string" ? JSON.parse(json) : json;
  if (Array.isArray(parsed) || (parsed && Array.isArray(parsed.stories) && !parsed.kind)) {
    throw new Error("That is a story bank export. Use \"Import story bank\" for it.");
  }
  const kind = parsed?.kind;
  if (!PROFILE_FIELDS[kind] || !parsed.data || typeof parsed.data !== "object") {
    throw new Error("Not a candidate or job export: expected {kind: candidate|job, data: {...}}.");
  }
  const d = parsed.data;
  const text = (f) => (d[f] === undefined ? undefined : typeof d[f] === "string" ? d[f] : String(d[f] ?? ""));
  const list = (f) => {
    if (d[f] === undefined) return undefined;
    if (!Array.isArray(d[f])) throw new Error(`Not a valid ${kind} export: "${f}" must be a list.`);
    return d[f];
  };
  const resources = (list("resources") || [])
    .filter((r) => r && typeof r === "object" && typeof r.text === "string")
    .map((r) => ({ kind: typeof r.kind === "string" ? r.kind : "other", text: r.text }));
  const data = kind === "candidate"
    ? { name: text("name") ?? "", cvText: text("cvText") ?? "", stories: importBank({ stories: list("stories") || [] }).stories, resources }
    : { title: text("title") ?? "", jobDescription: text("jobDescription") ?? "", resources, likelyQuestions: normalizeLikely(list("likelyQuestions") || []) };
  return { kind, data };
}
