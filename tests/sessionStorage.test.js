import { test } from "node:test";
import assert from "node:assert/strict";
import { appendTranscript, updateSession, saveSessionDraft, recoverSessionDrafts } from "../storage.js";

test("late debriefs update their original session, even with concurrent writes", async () => {
  const data = {};
  globalThis.chrome = { storage: { local: {
    get: async keys => structuredClone(Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map(key => [key, data[key]]))),
    set: async values => Object.assign(data, structuredClone(values)),
  } } };
  try {
    await Promise.all([appendTranscript({ id: "session-a", lines: ["A"] }), appendTranscript({ id: "session-b", lines: ["B"] })]);
    await updateSession({ id: "session-a", lines: ["A"], debrief: "Debrief A" });
    assert.deepEqual(data.sessions.map(s => s.id), ["session-a", "session-b"]);
    assert.equal(data.sessions[0].debrief, "Debrief A");
    assert.deepEqual(data.sessions[1].lines, ["B"]);
    await updateSession({ id: "expired-session", lines: [] });
    assert.equal(data.sessions.length, 2);
  } finally { delete globalThis.chrome; }
});

test("interrupted transcript checkpoints recover once without replacing completed sessions", async () => {
  const data = {};
  globalThis.chrome = { storage: { local: {
    get: async keys => structuredClone(Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map(key => [key, data[key]]))),
    set: async values => Object.assign(data, structuredClone(values)),
  } } };
  try {
    const lines = [{ speaker: "interviewer", text: "Question", t: 1000 }, { speaker: "candidate", text: "Answer", t: 2000 }];
    await saveSessionDraft({ id: "draft-a", start: 1000, end: 3000, candidateName: "Candidate A", jobTitle: "Job A", lines });
    lines[1].text = "Changed after checkpoint";
    const recovered = await recoverSessionDrafts();
    assert.equal(recovered[0].lines[1].text, "Answer");
    assert.equal(data.sessions[0].candidateName, "Candidate A");
    assert.equal(data.sessions[0].recovered, true);
    assert.deepEqual(await recoverSessionDrafts(), []);
    await saveSessionDraft({ id: "draft-b", start: 4000, end: 5000, lines });
    await appendTranscript({ id: "draft-b", start: 4000, end: 6000, lines });
    assert.deepEqual(await recoverSessionDrafts(), []);
    assert.equal(data.sessions.length, 2);
  } finally { delete globalThis.chrome; }
});
