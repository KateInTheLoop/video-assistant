import { test } from "node:test";
import assert from "node:assert/strict";
import { SttStream } from "../stt.js";

test("Deepgram uses low-delay formatting and forwards partial words immediately", async () => {
  const previous = globalThis.WebSocket;
  globalThis.WebSocket = class { constructor(url) { this.url = url; queueMicrotask(() => this.onopen()); } };
  try {
    const interims = [], finals = [];
    const stream = new SttStream({ apiKey: "example", speaker: "candidate", onInterim: value => interims.push(value), onFinal: value => finals.push(value) });
    stream.sampleRate = 16000;
    await stream.connect();
    const query = new URL(stream.ws.url).searchParams;
    assert.equal(query.get("no_delay"), "true");
    assert.equal(query.get("interim_results"), "true");
    assert.equal(query.get("endpointing"), "300");
    assert.equal(query.get("sample_rate"), "16000");
    stream.sentAudioSeconds = 1;
    const send = (text, final) => stream.ws.onmessage({ data: JSON.stringify({ type: "Results", start: 0, duration: 0.8, is_final: final, speech_final: final,
      channel: { alternatives: [{ transcript: text }] } }) });
    send("One hundred", false);
    assert.equal(interims.length, 1, "no endpoint, formatting timer, or LLM wait before interim callback");
    assert.equal(interims[0].backlogMs, 200);
    assert.equal(finals.length, 0);
    send("One hundred dollars.", true);
    assert.equal(finals.length, 1);
    assert.equal(finals[0].speechFinal, true);
    await stream.connect();
    assert.equal(stream.sentAudioSeconds, 0, "new server timestamps have their own audio cursor");
  } finally { globalThis.WebSocket = previous; }
});
