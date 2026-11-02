import { test } from "node:test";
import assert from "node:assert/strict";
import { AssemblyAiStream } from "../stt-assemblyai.js";

test("reconnecting resets turn deduplication and rejects events from the old connection", async () => {
  const previous = globalThis.WebSocket;
  globalThis.WebSocket = class { constructor() { queueMicrotask(() => this.onopen()); } };
  try {
    const finals = [];
    const stream = new AssemblyAiStream({ speaker: "interviewer", onInterim() {}, onFinal: event => finals.push(event.text) });
    stream.fetchToken = async () => "example-token";
    const send = (socket, turn, formatted = true) => socket.onmessage({ data: JSON.stringify({ type: "Turn", end_of_turn: true, turn_is_formatted: formatted, turn_order: turn, transcript: `Turn ${turn}` }) });
    await stream.connect();
    const old = stream.ws;
    send(old, 10); send(old, 11, false);
    assert.equal(stream.finalFallbacks.size, 1);
    await stream.connect();
    assert.equal(stream.finalFallbacks.size, 0);
    send(old, 12);
    send(stream.ws, 0); send(stream.ws, 0); send(stream.ws, 1);
    assert.deepEqual(finals, ["Turn 10", "Turn 0", "Turn 1"]);
  } finally { globalThis.WebSocket = previous; }
});
