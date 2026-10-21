// Converts float32 audio to 16-bit PCM chunks for the speech-to-text websocket.
class PcmWorklet extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buf = [];
    this.len = 0;
  }
  process(inputs) {
    const ch = inputs[0]?.[0];
    if (!ch) return true;
    const out = new Int16Array(ch.length);
    for (let i = 0; i < ch.length; i++) {
      const s = Math.max(-1, Math.min(1, ch[i]));
      out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    this.buf.push(out);
    this.len += out.length;
    if (this.len >= 1600) { // ~100ms at 16kHz
      const merged = new Int16Array(this.len);
      let o = 0;
      for (const b of this.buf) { merged.set(b, o); o += b.length; }
      this.port.postMessage(merged.buffer, [merged.buffer]);
      this.buf = []; this.len = 0;
    }
    return true;
  }
}
registerProcessor("pcm-worklet", PcmWorklet);
