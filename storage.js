// Settings live in chrome.storage.local. Keys, provider and model are flat; everything about
// the candidate and the job lives in profiles (lib/profiles.js) so one CV and story bank can
// serve many applications. loadSettings() still returns the flat fields the coach has always
// read (cvText, stories, jobDescription, resources…), taken from the active candidate and job.
import { migrate, flatten, applyFlat, isProfiles, emptyProfiles, FLAT_KEYS } from "./lib/profiles.js";

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

export async function loadProfiles() {
  return resolveProfiles(await chrome.storage.local.get(["profiles", ...LEGACY_KEYS]));
}

export async function loadSettings() {
  const stored = await chrome.storage.local.get(ALL_KEYS);
  const profiles = await resolveProfiles(stored);
  const base = Object.fromEntries(Object.keys(DEFAULTS).map((k) => [k, stored[k] ?? DEFAULTS[k]]));
  return { ...base, profiles, ...flatten(profiles) };
}

// Accepts flat fields (written into the active candidate / job), a whole `profiles` object,
// or plain settings keys, in any mix.
export async function saveSettings(partial) {
  const { profiles: incoming, ...rest } = partial;
  const flat = {}, other = {};
  for (const [k, v] of Object.entries(rest)) (FLAT_KEYS.includes(k) ? flat : other)[k] = v;
  const out = { ...other };
  if (incoming || Object.keys(flat).length) {
    const current = incoming || await loadProfiles();
    out.profiles = Object.keys(flat).length ? applyFlat(current, flat) : current;
  }
  await chrome.storage.local.set(out);
}

// --- Sessions (transcript, pace, debrief per stopped call); the last 20 are kept ------------

export async function appendTranscript(session) {
  const { sessions = [] } = await chrome.storage.local.get("sessions");
  sessions.push(session);
  await chrome.storage.local.set({ sessions: sessions.slice(-20) });
}

export async function updateLastSession(session) {
  const { sessions = [] } = await chrome.storage.local.get("sessions");
  if (sessions.length) sessions[sessions.length - 1] = session;
  await chrome.storage.local.set({ sessions });
}
