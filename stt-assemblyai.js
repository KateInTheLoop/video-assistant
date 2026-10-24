import { backoffDelays } from "./lib/backoff.js";

// AssemblyAI Universal-Streaming (v3) connection, one per audio source.
// Same interface as SttStream (stt.js) so panel.js can swap providers.
// Browser flow: the API key fetches a short-lived token over REST, then the
// WebSocket is opened with ?token= (a browser WebSocket cannot set headers).
const TOKEN_URL = "https://streaming.assemblyai.com/v3/token";
const WS_URL = "wss://streaming.assemblyai.com/v3/ws";

// Verify a key by asking for a token. 200 = usable, 401 = disabled/invalid.
export async function checkAssemblyAiKey(apiKey) {
  if (!apiKey) return { ok: false, reason: "No AssemblyAI key saved." };
  let res;
  try {
    res = await fetch(`${TOKEN_URL}?expires_in_seconds=60`, { headers: { Authorization: apiKey } });
  } catch (e) {
    return { ok: false, reason: `Cannot reach streaming.assemblyai.com (${e.message}). Check network, VPN or firewall.` };
  }
  if (res.status === 401 || res.status === 403) return { ok: false, reason: `AssemblyAI rejected the key (HTTP ${res.status}). Check it is enabled in the dashboard.` };
  if (!res.ok) return { ok: false, reason: `AssemblyAI returned HTTP ${res.status}.` };
  return { ok: true, reason: "Key OK." };
}

export class AssemblyAiStream {
  constructor({ apiKey, speaker, onInterim, onFinal, onUtteranceEnd, onError }) {
    this.apiKey = apiKey;
    this.speaker = speaker;
    this.onInterim = onInterim;
    this.onFinal = onFinal;
    this.onUtteranceEnd = onUtteranceEnd;
    this.onError = onError;
    this.ws = null;
    this.ctx = null;
    this.mediaStream = null;
    this.retries = 0;
    this.stopped = false;
    this.finalizedTurn = -1;   // dedupe: formatted + unformatted finals share a turn_order
    this.finalFallbacks = new Map(); // turn_order -> timer emitting the unformatted text if no formatted one comes
    this.onStatus = () => {};
  }

  async start(mediaStream) {
    this.mediaStream = mediaStream;
    this.stopped = false;
    this.sampleRate = await this.openAudioContext();
    await this.connect();
    await this.startAudio(mediaStream);
  }

  // Match stt.js: prefer 16 kHz, fall back to the device rate, report the real one.
  async openAudioContext() {
    try { this.ctx = new AudioContext({ sampleRate: 16000 }); }
    catch { this.ctx = new AudioContext(); }
    if (this.ctx.state === "suspended") await this.ctx.resume();
    return this.ctx.sampleRate;
  }

  async fetchToken() {
    const res = await fetch(`${TOKEN_URL}?expires_in_seconds=120`, { headers: { Authorization: this.apiKey } });
    if (!res.ok) throw new Error(`AssemblyAI token request failed (${this.speaker}): HTTP ${res.status}`);
    const { token } = await res.json();
    if (!token) throw new Error(`AssemblyAI returned no token (${this.speaker}).`);
    return token;
  }

  emitFinal(turnOrder, text) {
    clearTimeout(this.finalFallbacks.get(turnOrder)); this.finalFallbacks.delete(turnOrder);
    if (turnOrder <= this.finalizedTurn) return;
    this.finalizedTurn = turnOrder;
    this.onFinal({ speaker: this.speaker, text, speechFinal: true });
    this.onUtteranceEnd?.({ speaker: this.speaker });
  }

  async connect() {
    const token = await this.fetchToken();
    const params = new URLSearchParams({
      sample_rate: String(this.sampleRate || 16000),
      format_turns: "true",
      token,
    });
    this.ws = new WebSocket(`${WS_URL}?${params}`);
    this.ws.binaryType = "arraybuffer";

    await new Promise((resolve, reject) => {
      this.ws.onopen = resolve;
      this.ws.onerror = () => reject(new Error(`AssemblyAI connection failed (${this.speaker}).`));
    });

    this.ws.onmessage = (ev) => {
      let msg; try { msg = JSON.parse(ev.data); } catch { return; }
      if (msg.type === "Turn") {
        this.retries = 0; // a stable connection: data is flowing
        const text = (msg.transcript || "").trim();
        if (!text) return;
        if (!msg.end_of_turn) { this.onInterim({ speaker: this.speaker, text }); return; }
        // end_of_turn arrives twice per turn with format_turns: unformatted first, then formatted
        // (punctuation and casing, which question.js needs). Prefer the formatted one; if it does
        // not come within a short window, emit the unformatted text so nothing is lost.
        if (msg.turn_order <= this.finalizedTurn) return;
        if (msg.turn_is_formatted) {
          this.emitFinal(msg.turn_order, text);
        } else if (!this.finalFallbacks.has(msg.turn_order)) {
          this.onInterim({ speaker: this.speaker, text });
          this.finalFallbacks.set(msg.turn_order, setTimeout(() => this.emitFinal(msg.turn_order, text), 1500));
        }
      } else if (msg.type === "Error" || msg.error) {
        this.onError?.(new Error(msg.error || "AssemblyAI error"));
      }
    };
    this.ws.onclose = (e) => { if (e.code !== 1000 && !this.stopped) this.reconnect(e); };
  }

  // Reconnect with backoff while the media stream is live (mirrors stt.js).
  async reconnect(closeEvent) {
    const delays = backoffDelays();
    const live = this.mediaStream?.getAudioTracks().some((t) => t.readyState === "live");
    if (!live || this.retries >= delays.length) {
      this.onError?.(new Error(`AssemblyAI closed (${this.speaker}): ${closeEvent.code} ${closeEvent.reason || ""}`.trim()));
      return;
    }
    const delay = delays[this.retries++];
    this.onStatus(`Transcription dropped (${this.speaker}), reconnecting in ${delay / 1000}s…`);
    await new Promise((r) => setTimeout(r, delay));
    if (this.stopped) return;
    try { await this.connect(); this.onStatus(`Transcription back (${this.speaker}).`); }
    catch (e) { this.reconnect({ code: 1006, reason: e.message }); }
  }

  async startAudio(mediaStream) {
    await this.ctx.audioWorklet.addModule("pcm-worklet.js");
    const src = this.ctx.createMediaStreamSource(mediaStream);
    const node = new AudioWorkletNode(this.ctx, "pcm-worklet");
    node.port.onmessage = (e) => {
      if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(e.data);
    };
    src.connect(node);
    const mute = this.ctx.createGain(); mute.gain.value = 0;
    node.connect(mute).connect(this.ctx.destination);
  }

  stop() {
    this.stopped = true;
    for (const t of this.finalFallbacks.values()) clearTimeout(t);
    this.finalFallbacks.clear();
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: "Terminate" }));
      this.ws.close(1000);
    } else if (this.ws?.readyState === WebSocket.CONNECTING) {
      this.ws.close(); // abort the handshake so a late open cannot leak a billed session
    }
    this.ctx?.close();
    this.ws = null; this.ctx = null;
  }
}
