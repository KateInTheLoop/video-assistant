import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

test("audio packets flush near 50ms at both preferred and fallback sample rates", () => {
  for (const rate of [16000, 48000]) {
    const packets = []; let Processor;
    const context = vm.createContext({ sampleRate: rate, Int16Array,
      AudioWorkletProcessor: class { constructor() { this.port = { postMessage: data => packets.push(data) }; } },
      registerProcessor: (_name, constructor) => { Processor = constructor; },
    });
    vm.runInContext(readFileSync(new URL("../pcm-worklet.js", import.meta.url), "utf8"), context);
    const processor = new Processor(), frame = new Float32Array(128).fill(0.5);
    let samples = 0;
    while (!packets.length) {
      processor.process([[frame]]); samples += 128;
      assert.ok(samples / rate < 0.07, "must not wait for the old 100ms batch");
    }
    const durationMs = packets[0].byteLength / 2 / rate * 1000;
    assert.ok(durationMs >= 50 && durationMs < 60, `packet is ${durationMs}ms at ${rate}Hz`);
    assert.equal(new Int16Array(packets[0])[0], 16383);
  }
});
