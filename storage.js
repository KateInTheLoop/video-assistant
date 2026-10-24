export const DEFAULTS = {
  anthropicKey: "",
  deepgramKey: "",
  assemblyaiKey: "",
  sttProvider: "deepgram",   // "deepgram" | "assemblyai"
  model: "claude-haiku-5-5",   // live hints: speed and cost; prep/debrief use PREP_MODEL in claude.js
  cvText: "",
  jobDescription: "",
  stories: [],          // [{title, situation, action, result, tags}]
  resources: [],
  contextTier: "full",  // lean | standard | full: how much of the above goes to the coach        // [{kind, text}] extra materials for the coach: cover letter, LinkedIn, research, notes
  candidateName: "",
};

export async function loadSettings() {
  const stored = await chrome.storage.local.get(Object.keys(DEFAULTS));
  return { ...DEFAULTS, ...stored };
}

export async function saveSettings(partial) {
  await chrome.storage.local.set(partial);
}

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
