// Saved profiles: a list of candidates (who is interviewing) and a list of jobs (what for).
// A session uses one of each, so one CV and story bank serve many applications without
// copying. Pure: storage.js persists, Settings edits, and panel.js only ever sees flatten(),
// which is exactly the flat settings shape it has always read.

// Materials describing the job rather than the candidate. Everything else is the candidate's.
export const JOB_RESOURCE_KINDS = new Set(["cover_letter", "company"]);

const emptyCandidate = () => ({ name: "", cvText: "", stories: [], resources: [] });
const emptyJob = () => ({ title: "", jobDescription: "", resources: [], likelyQuestions: [] });

export function emptyProfiles() {
  return { candidates: {}, jobs: {}, activeCandidate: null, activeJob: null };
}

const clone = (p) => JSON.parse(JSON.stringify(p));

// Short ids, unique within a list; the human label lives in name / title.
export function newId(prefix, existing) {
  let n = Object.keys(existing).length + 1;
  while (existing[`${prefix}-${n}`]) n++;
  return `${prefix}-${n}`;
}

export function addCandidate(profiles, fields = {}) {
  const p = clone(profiles);
  const id = newId("c", p.candidates);
  p.candidates[id] = { ...emptyCandidate(), ...fields };
  p.activeCandidate = id;
  return { profiles: p, id };
}

export function addJob(profiles, fields = {}) {
  const p = clone(profiles);
  const id = newId("j", p.jobs);
  p.jobs[id] = { ...emptyJob(), ...fields };
  p.activeJob = id;
  return { profiles: p, id };
}

export function updateCandidate(profiles, id, fields) {
  const p = clone(profiles);
  if (!p.candidates[id]) throw new Error(`no candidate ${id}`);
  p.candidates[id] = { ...p.candidates[id], ...fields };
  return p;
}

export function updateJob(profiles, id, fields) {
  const p = clone(profiles);
  if (!p.jobs[id]) throw new Error(`no job ${id}`);
  p.jobs[id] = { ...p.jobs[id], ...fields };
  return p;
}

export function duplicateCandidate(profiles, id) {
  const src = profiles.candidates[id];
  if (!src) throw new Error(`no candidate ${id}`);
  return addCandidate(profiles, { ...clone(src), name: `${src.name || "Candidate"} (copy)` });
}

export function duplicateJob(profiles, id) {
  const src = profiles.jobs[id];
  if (!src) throw new Error(`no job ${id}`);
  return addJob(profiles, { ...clone(src), title: `${src.title || "Job"} (copy)` });
}

// Removing the active one hands the slot to the first remaining entry, or null.
export function removeCandidate(profiles, id) {
  const p = clone(profiles);
  delete p.candidates[id];
  if (p.activeCandidate === id) p.activeCandidate = Object.keys(p.candidates)[0] ?? null;
  return p;
}

export function removeJob(profiles, id) {
  const p = clone(profiles);
  delete p.jobs[id];
  if (p.activeJob === id) p.activeJob = Object.keys(p.jobs)[0] ?? null;
  return p;
}

export function setActive(profiles, { candidate, job } = {}) {
  const p = clone(profiles);
  if (candidate !== undefined) {
    if (candidate !== null && !p.candidates[candidate]) throw new Error(`no candidate ${candidate}`);
    p.activeCandidate = candidate;
  }
  if (job !== undefined) {
    if (job !== null && !p.jobs[job]) throw new Error(`no job ${job}`);
    p.activeJob = job;
  }
  return p;
}

export const activeCandidate = (p) => p.candidates[p.activeCandidate] || null;
export const activeJob = (p) => p.jobs[p.activeJob] || null;

// Labels for the dropdowns. A job with no title shows the first line of its description.
export const candidateLabel = (c) => c?.name?.trim() || "Unnamed candidate";
export function jobLabel(j) {
  if (j?.title?.trim()) return j.title.trim();
  const first = (j?.jobDescription || "").trim().split("\n")[0].trim();
  return first ? first.slice(0, 40) : "Untitled job";
}

// The flat view the coach reads: unchanged field names, candidate materials first.
export const FLAT_KEYS = ["candidateName", "cvText", "stories", "jobTitle", "jobDescription", "likelyQuestions", "resources"];

export function flatten(profiles) {
  const c = activeCandidate(profiles) || emptyCandidate();
  const j = activeJob(profiles) || emptyJob();
  return {
    candidateName: c.name || "",
    cvText: c.cvText || "",
    stories: c.stories || [],
    jobTitle: j.title || "",
    jobDescription: j.jobDescription || "",
    likelyQuestions: j.likelyQuestions || [],
    resources: [...(c.resources || []), ...(j.resources || [])],
  };
}

// Writes flat fields (what Settings autosaves) into the active profiles, creating one of each
// if the list is empty. Materials are split by kind: cover letter and company research go to
// the job, the rest to the candidate.
export function applyFlat(profiles, flat) {
  let p = clone(profiles);
  if (!p.activeCandidate || !p.candidates[p.activeCandidate]) p = addCandidate(p).profiles;
  if (!p.activeJob || !p.jobs[p.activeJob]) p = addJob(p).profiles;
  const c = p.candidates[p.activeCandidate];
  const j = p.jobs[p.activeJob];
  if ("candidateName" in flat) c.name = flat.candidateName ?? "";
  if ("cvText" in flat) c.cvText = flat.cvText ?? "";
  if ("stories" in flat) c.stories = flat.stories ?? [];
  if ("jobTitle" in flat) j.title = flat.jobTitle ?? "";
  if ("jobDescription" in flat) j.jobDescription = flat.jobDescription ?? "";
  if ("likelyQuestions" in flat) j.likelyQuestions = flat.likelyQuestions ?? [];
  if ("resources" in flat) {
    const rs = (flat.resources ?? []).filter(Boolean);
    c.resources = rs.filter((r) => !JOB_RESOURCE_KINDS.has(r.kind));
    j.resources = rs.filter((r) => JOB_RESOURCE_KINDS.has(r.kind));
  }
  return p;
}

// One-time migration: the flat settings an existing install has become one candidate and one
// job. Empty input still yields one of each so the dropdowns have something to select.
export function migrate(flat = {}) {
  let p = emptyProfiles();
  p = addCandidate(p, { name: flat.candidateName || "" }).profiles;
  p = addJob(p).profiles;
  return applyFlat(p, {
    cvText: flat.cvText || "",
    stories: flat.stories || [],
    jobDescription: flat.jobDescription || "",
    likelyQuestions: flat.likelyQuestions || [],
    resources: flat.resources || [],
  });
}

// True when stored data is already in the profiles shape.
export const isProfiles = (x) => !!x && typeof x === "object" && x.candidates && x.jobs && typeof x.candidates === "object";
