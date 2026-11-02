// Selection is shared by the prompt and the coach display. Return the original resource
// so the candidate's prepared wording, including whitespace, is never rewritten here.
export const RESUME_SUMMARY_KIND = "resume_summary";
export const RESUME_SUMMARY_LABEL = "Resume summary / prepared answer";

export function resumeSummaryPriority(resource) {
  return Number.isInteger(resource?.priority) && resource.priority >= 0 && resource.priority <= 5
    ? resource.priority : 5;
}

export function resumeSummaryOwner(resource) {
  return ["candidate", "job"].includes(resource?.scope) ? resource.scope : "job";
}

// Highest enabled priority wins; at a tie, this job beats a general candidate answer.
// Equivalent answers retain source order. Empty, malformed and Off materials cannot win.
export function preparedResume(resources = []) {
  let selected = null;
  for (const resource of Array.isArray(resources) ? resources : []) {
    if (!resource || typeof resource !== "object" || resource.kind !== RESUME_SUMMARY_KIND
      || typeof resource.text !== "string" || !resource.text.trim()) continue;
    const priority = resumeSummaryPriority(resource);
    if (!priority) continue;
    const previous = selected ? resumeSummaryPriority(selected) : -1;
    if (priority > previous || (priority === previous && resumeSummaryOwner(resource) === "job"
      && resumeSummaryOwner(selected) !== "job")) selected = resource;
  }
  return selected;
}
