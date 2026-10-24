// Extra context for the coach beyond CV, job and stories, plus what it is told about the
// interview so far. Pure, so the shape of what Claude sees is testable.

// One list, one dropdown: the user should not feel they are filling in a recruitment form.
export const RESOURCE_KINDS = [
  { id: "cover_letter", label: "Cover / motivation letter" },
  { id: "linkedin", label: "LinkedIn profile" },
  { id: "company", label: "Company research" },
  { id: "notes", label: "Notes for the coach" },
  { id: "other", label: "Other" },
];
export const MAX_MATERIALS_CHARS = 24000; // ~6k tokens; cached, so this is a latency guard, not a cost one
export const CACHE_MIN_TOKENS = 512;      // below this the prefix silently does not cache on current models

// How much of what the user has entered actually goes to the coach. One dropdown, three
// honest choices; the default is everything they bothered to add.
export const TIERS = [
  { id: "lean", label: "Lean — stories and job only", includes: { stories: true, jobDescription: true, cvText: false, resources: false } },
  { id: "standard", label: "Standard — plus CV", includes: { stories: true, jobDescription: true, cvText: true, resources: false } },
  { id: "full", label: "Everything — plus extra materials (default)", includes: { stories: true, jobDescription: true, cvText: true, resources: true } },
];
export const DEFAULT_TIER = "full";

export function tierIncludes(tier) {
  return (TIERS.find((t) => t.id === tier) || TIERS.find((t) => t.id === DEFAULT_TIER)).includes;
}

// The prefix inputs with the excluded components blanked, so the request builder and the
// report cannot disagree about what was sent.
export function applyTier({ stories = [], jobDescription = "", cvText = "", resources = [] }, tier) {
  const inc = tierIncludes(tier);
  return {
    stories: inc.stories ? stories : [],
    jobDescription: inc.jobDescription ? jobDescription : "",
    cvText: inc.cvText ? cvText : "",
    resources: inc.resources ? resources : [],
  };
}

export function kindLabel(id) {
  return RESOURCE_KINDS.find((k) => k.id === id)?.label || "Other";
}

// Materials as one block for the cached prefix. Stable ordering = stable cache.
export function materialsText(resources = []) {
  const parts = resources
    .filter((r) => r && typeof r.text === "string" && r.text.trim())
    .map((r) => `## ${kindLabel(r.kind)}\n${r.text.trim()}`);
  if (!parts.length) return "";
  let out = parts.join("\n\n");
  if (out.length > MAX_MATERIALS_CHARS) out = `${out.slice(0, MAX_MATERIALS_CHARS).trimEnd()}\n[... materials truncated at ${MAX_MATERIALS_CHARS} characters]`;
  return out;
}

// The coach's memory of the interview: what was asked and which stories were used. Built from
// the question queue the panel already keeps, so it costs no extra API call. Goes in the user
// turn, never the cached prefix.
export function sessionDigest(questions = [], { max = 12 } = {}) {
  const asked = questions.filter((q) => q?.hint?.is_question);
  if (!asked.length) return "";
  const recent = asked.slice(-max);
  const skipped = asked.length - recent.length;
  const lines = recent.map((q, i) => {
    const used = (q.hint.stories || []).map((s) => s.title).join(", ");
    return `${skipped + i + 1}. ${q.hint.question_summary} → ${used ? `used: ${used}` : "no story"}`;
  });
  return (skipped ? `(${skipped} earlier question${skipped === 1 ? "" : "s"} omitted)\n` : "") + lines.join("\n");
}

// Rough but honest: ~4 characters per token for English prose. Labelled as an estimate in the UI.
export function estimateTokens(text) {
  return Math.ceil(String(text ?? "").length / 4);
}
