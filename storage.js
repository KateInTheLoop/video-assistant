// Settings live in chrome.storage.local. Keys, provider and model are flat; everything about
// the candidate and the job lives in profiles (lib/profiles.js) so one CV and story bank can
// serve many applications. loadSettings() still returns the flat fields the coach has always
// read (cvText, stories, jobDescription, resources…), taken from the active candidate and job.
import { migrate, flatten, applyFlat, isProfiles, emptyProfiles, FLAT_KEYS } from "./lib/profiles.js";
import { answerStats, paceSummary } from "./lib/pace.js";

// Web Locks coordinate extension windows as well as the background worker. The queue is
// for non-browser tests; Chrome uses the shared origin lock for every read/modify/write.
let storageQueue = Promise.resolve();
function storageTask(work) {
  if (globalThis.navigator?.locks) return navigator.locks.request("interview-coach-storage", work);
  const run = storageQueue.then(work, work);
  storageQueue = run.catch(() => {});
  return run;
}

export const DEFAULTS = {
  anthropicKey: "",
  deepgramKey: "",
  assemblyaiKey: "",
  sttProvider: "deepgram",   // "deepgram" | "assemblyai"
  model: "claude-haiku-5-5",   // live hints: speed and cost; prep/debrief use PREP_MODEL in claude.js
  contextTier: "full",  // lean | standard | full: how much of the profiles goes to the coach
  devMode: false,       // developer mode: trace points to the console and a .trace.log next to the transcript
};

// The flat keys an install from before profiles stored directly. Migrated once, then removed.
const LEGACY_KEYS = ["cvText", "jobDescription", "stories", "resources", "candidateName", "likelyQuestions"];
const ALL_KEYS = [...Object.keys(DEFAULTS), "profiles", ...LEGACY_KEYS];

// Profiles from one storage read. Migrates once, only when no `profiles` key exists at all.
// A present-but-malformed value is never "repaired" from the legacy keys (they are gone by
// then): it is treated as empty in memory and left in storage until the user saves something.
async function resolveProfiles(stored) {
  if (isProfiles(stored.profiles)) return stored.profiles;
  if (stored.profiles !== undefined) {
    console.error("Interview Coach: stored profiles are malformed; starting empty in memory.", stored.profiles);
    return emptyProfiles();
  }
  const profiles = migrate(stored);
  // The coach window and the Settings page can both see the legacy shape on the first load
  // after an upgrade. Whichever gets here second must not overwrite what the first wrote, or
  // any edit made since, so re-read once before writing.
  const again = await chrome.storage.local.get("profiles");
  if (isProfiles(again.profiles)) return again.profiles;
  await chrome.storage.local.set({ profiles });
  await chrome.storage.local.remove(LEGACY_KEYS);
  return profiles;
}

export function loadProfiles() {
  return storageTask(async () => resolveProfiles(await chrome.storage.local.get(["profiles", ...LEGACY_KEYS])));
}

export function loadSettings() {
  return storageTask(async () => {
    const stored = await chrome.storage.local.get(ALL_KEYS);
    const profiles = await resolveProfiles(stored);
    const base = Object.fromEntries(Object.keys(DEFAULTS).map((k) => [k, stored[k] ?? DEFAULTS[k]]));
    return { ...base, profiles, ...flatten(profiles) };
  });
}

// Accepts flat fields (written into the active candidate / job), a whole `profiles` object,
// or plain settings keys, in any mix.
export function saveSettings(partial, { target, expectedRevision } = {}) {
  return storageTask(async () => {
    const { profiles: incoming, ...rest } = partial;
    const flat = {}, other = {};
    for (const [k, v] of Object.entries(rest)) (FLAT_KEYS.includes(k) ? flat : other)[k] = v;
    const out = { ...other };
    if (incoming || Object.keys(flat).length) {
      const stored = await resolveProfiles(await chrome.storage.local.get(["profiles", ...LEGACY_KEYS]));
      if (expectedRevision !== undefined && expectedRevision !== (stored.revision || 0)) {
        throw new Error("Profiles changed in another Settings window. Your edits were not saved. Reload saved settings before editing again.");
      }
      let current = incoming || stored;
      if (target) {
        if (!current.candidates[target.candidate] || !current.jobs[target.job]) throw new Error("This candidate or job was deleted. Reload saved settings.");
        current = { ...current, activeCandidate: target.candidate, activeJob: target.job };
      }
      const updated = Object.keys(flat).length ? applyFlat(current, flat) : current;
      out.profiles = { ...updated, revision: (stored.revision || 0) + 1 };
      if (target) {
        out.profiles.activeCandidate = stored.activeCandidate;
        out.profiles.activeJob = stored.activeJob;
      }
    }
    await chrome.storage.local.set(out);
    return out.profiles;
  });
}

// --- Sessions (transcript, pace, debrief per stopped call); the last 20 are kept ------------

export function appendTranscript(session) {
  return storageTask(async () => {
    const { sessions = [], sessionDrafts = {} } = await chrome.storage.local.get(["sessions", "sessionDrafts"]);
    const index = sessions.findIndex((s) => s.id === session.id);
    if (index < 0) sessions.push(session); else sessions[index] = session;
    delete sessionDrafts[session.id];
    await chrome.storage.local.set({ sessions: sessions.slice(-20), sessionDrafts });
  });
}

export function updateSession(session) {
  return storageTask(async () => {
    const { sessions = [] } = await chrome.storage.local.get("sessions");
    const index = sessions.findIndex((s) => s.id === session.id);
    // A session removed by retention must never overwrite a newer one or be resurrected.
    if (!session.id || index < 0) return;
    sessions[index] = session;
    await chrome.storage.local.set({ sessions });
  });
}

export function saveSessionDraft(draft) {
  // Snapshot at the event, before waiting for another window's write.
  const snapshot = structuredClone(draft);
  return storageTask(async () => {
    const { sessionDrafts = {} } = await chrome.storage.local.get("sessionDrafts");
    sessionDrafts[snapshot.id] = snapshot;
    await chrome.storage.local.set({ sessionDrafts });
  });
}

export function recoverSessionDrafts() {
  return storageTask(async () => {
    const { sessions = [], sessionDrafts = {} } = await chrome.storage.local.get(["sessions", "sessionDrafts"]);
    const recovered = Object.values(sessionDrafts).filter((s) => s.id && s.lines?.length && !sessions.some((x) => x.id === s.id))
      .sort((a, b) => a.start - b.start).map((s) => {
        const pace = answerStats(s.lines, s.end);
        return { ...s, recovered: true, pace, paceSummary: paceSummary(pace) };
      });
    if (Object.keys(sessionDrafts).length) await chrome.storage.local.set({ sessions: [...sessions, ...recovered].slice(-20), sessionDrafts: {} });
    return recovered;
  });
}
