// Settings live in chrome.storage.local. Keys, provider and model are flat; everything about
// the candidate and the job lives in profiles (lib/profiles.js) so one CV and story bank can
// serve many applications. loadSettings() still returns the flat fields the coach has always
// read (cvText, stories, jobDescription, resources…), taken from the active candidate and job.
import { migrate, flatten, applyFlat, isProfiles, FLAT_KEYS } from "./lib/profiles.js";

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

export async function loadProfiles() {
  const stored = await chrome.storage.local.get(["profiles", ...LEGACY_KEYS]);
  if (isProfiles(stored.profiles)) return stored.profiles;
  const profiles = migrate(stored);
  await chrome.storage.local.set({ profiles });
  await chrome.storage.local.remove(LEGACY_KEYS);
  return profiles;
}

export async function loadSettings() {
  const base = await chrome.storage.local.get(Object.keys(DEFAULTS));
  const profiles = await loadProfiles();
  return { ...DEFAULTS, ...base, profiles, ...flatten(profiles) };
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
