// One Deepgram streaming connection per audio source (interviewer tab, candidate mic).
// Keeping the streams separate is what lets us know who said what.
export class SttStream {
  constructor({ apiKey, speaker, onInterim, onFinal, onUtteranceEnd, onError }) {
    this.apiKey = apiKey;
    this.speaker = speaker;
    this.onInterim = onInterim;
    this.onFinal = onFinal;
    this.onUtteranceEnd = onUtteranceEnd;
    this.onError = onError;
    this.ws = null;
    this.ctx = null;
    this.keepalive = null;
  }

  async start(mediaStream) {
    const params = new URLSearchParams({
      model: "nova-3",
      language: "en",
      encoding: "linear16",
      sample_rate: "16000",
      channels: "1",
      interim_results: "true",
      smart_format: "true",
      punctuate: "true",
      endpointing: "300",
      utterance_end_ms: "1200",
      vad_events: "true",
    });
    // Browsers can't set headers on WebSocket; Deepgram accepts the key as a subprotocol.
    this.ws = new WebSocket(`wss://api.deepgram.com/v1/listen?${params}`, ["token", this.apiKey]);

    await new Promise((resolve, reject) => {
      this.ws.onopen = resolve;
      this.ws.onerror = () => reject(new Error(`Deepgram connection failed (${this.speaker})`));
    });

    this.ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.type === "Results") {
        const alt = msg.channel?.alternatives?.[0];
        const text = alt?.transcript?.trim();
        if (!text) return;
        if (msg.is_final) this.onFinal({ speaker: this.speaker, text, speechFinal: msg.speech_final });
        else this.onInterim({ speaker: this.speaker, text });
      } else if (msg.type === "UtteranceEnd") {
        this.onUtteranceEnd({ speaker: this.speaker });
      } else if (msg.type === "Error") {
        this.onError?.(new Error(msg.description || "Deepgram error"));
      }
    };
    this.ws.onclose = (e) => { if (e.code !== 1000) this.onError?.(new Error(`Deepgram closed (${this.speaker}): ${e.code} ${e.reason}`)); };

    // Ask the AudioContext for 16kHz so Chrome does the resampling for us.
    this.ctx = new AudioContext({ sampleRate: 16000 });
    await this.ctx.audioWorklet.addModule("pcm-worklet.js");
    const src = this.ctx.createMediaStreamSource(mediaStream);
    const node = new AudioWorkletNode(this.ctx, "pcm-worklet");
    node.port.onmessage = (e) => {
      if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(e.data);
    };
    src.connect(node);
    // Worklet needs a destination to run; a muted gain keeps the graph alive without playback.
    const mute = this.ctx.createGain(); mute.gain.value = 0;
    node.connect(mute).connect(this.ctx.destination);

    this.keepalive = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ type: "KeepAlive" }));
    }, 8000);
  }

  stop() {
    clearInterval(this.keepalive);
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: "CloseStream" }));
      this.ws.close(1000);
    }
    this.ctx?.close();
    this.ws = null; this.ctx = null;
  }
}
