import { test } from "node:test";
import assert from "node:assert/strict";
import { appendTranscript, updateSession } from "../storage.js";

test("late debriefs update their original session, even with concurrent writes", async () => {
  const data = {};
  globalThis.chrome = { storage: { local: {
    get: async key => structuredClone({ [key]: data[key] }),
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
