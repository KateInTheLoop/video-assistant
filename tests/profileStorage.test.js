import { test } from "node:test";
import assert from "node:assert/strict";
import { browserHarness } from "./browserHarness.js";
import { migrate, addCandidate } from "../lib/profiles.js";
import { loadSettings, saveSettings } from "../storage.js";

function storageMock(data) {
  return { storage: { local: {
    get: async keys => structuredClone(Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map(key => [key, data[key]]))),
    set: async values => Object.assign(data, structuredClone(values)),
    remove: async keys => { for (const key of keys) delete data[key]; },
  } } };
}

test("a stale Settings window cannot overwrite the candidate selected by another window", async () => {
  const profiles = addCandidate(migrate({ candidateName: "Candidate A", cvText: "CV A" }), { name: "Candidate B", cvText: "CV B" }).profiles;
  profiles.activeCandidate = "c-1";
  const data = { profiles };
  globalThis.chrome = storageMock(data);
  try {
    const a = await browserHarness("options.js", { chrome });
    const b = await browserHarness("options.js", { chrome });
    b.$("candidateSel").value = "c-2";
    await b.$("candidateSel").onchange();
    a.$("cvText").value = "Edited CV A";
    await a.$("btnSave").onclick();
    assert.equal(data.profiles.candidates["c-2"].name, "Candidate B");
    assert.equal(data.profiles.candidates["c-2"].cvText, "CV B");
    assert.equal(data.profiles.candidates["c-1"].cvText, "CV A");
    assert.match(a.$("saveStatus").textContent, /another Settings window/);
    assert.equal(a.$("cvText").value, "Edited CV A", "conflicts retain unsaved text");
    await a.$("btnReloadSettings").onclick();
    assert.equal(a.$("cvText").value, "CV B");
  } finally { delete globalThis.chrome; }
});

test("concurrent saves with the same revision cannot silently replace each other", async () => {
  const data = { profiles: migrate({ cvText: "Original" }) };
  globalThis.chrome = storageMock(data);
  try {
    const { profiles } = await loadSettings();
    const opts = { target: { candidate: profiles.activeCandidate, job: profiles.activeJob }, expectedRevision: profiles.revision || 0 };
    const results = await Promise.allSettled([saveSettings({ cvText: "First edit" }, opts), saveSettings({ cvText: "Second edit" }, opts)]);
    assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
    assert.equal(results.filter(r => r.status === "rejected").length, 1);
    assert.equal(data.profiles.candidates[profiles.activeCandidate].cvText, "First edit");
  } finally { delete globalThis.chrome; }
});

test("separate extension contexts use the shared Web Lock for conflict checks", async () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  let tail = Promise.resolve(), locks = 0;
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { locks: {
    request(name, work) {
      assert.equal(name, "interview-coach-storage"); locks++;
      const run = tail.then(work); tail = run.catch(() => {}); return run;
    },
  } } });
  globalThis.chrome = storageMock({ profiles: migrate({ cvText: "Original" }) });
  try {
    const a = await import("../storage.js?settings-window-a");
    const b = await import("../storage.js?settings-window-b");
    const results = await Promise.allSettled([a.saveSettings({ cvText: "A" }, { expectedRevision: 0 }), b.saveSettings({ cvText: "B" }, { expectedRevision: 0 })]);
    assert.equal(locks, 2);
    assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
    assert.equal(results.filter(r => r.status === "rejected").length, 1);
  } finally {
    delete globalThis.chrome;
    if (previous) Object.defineProperty(globalThis, "navigator", previous); else delete globalThis.navigator;
  }
});
