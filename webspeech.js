// Fallback for the candidate's mic when no Deepgram key is set: Chrome's built-in recognition.
// Same callback interface as SttStream. It cannot take an arbitrary MediaStream, so it is mic-only.
export class WebSpeechStream {
  constructor({ speaker, onInterim, onFinal, onUtteranceEnd, onError }) {
    Object.assign(this, { speaker, onInterim, onFinal, onUtteranceEnd, onError });
    this.rec = null;
    this.stopped = false;
    this.onStatus = () => {};
  }

  static supported() {
    return typeof window !== "undefined" && ("webkitSpeechRecognition" in window || "SpeechRecognition" in window);
  }

  async start() {
    const Rec = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Rec) throw new Error("Speech recognition is not available in this browser.");
    this.stopped = false;
    this.rec = new Rec();
    this.rec.lang = "en-US";
    this.rec.continuous = true;
    this.rec.interimResults = true;
    this.rec.onresult = (ev) => {
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const r = ev.results[i];
        const text = r[0].transcript.trim();
        if (!text) continue;
        if (r.isFinal) this.onFinal({ speaker: this.speaker, text, speechFinal: true });
        else this.onInterim({ speaker: this.speaker, text });
      }
    };
    this.rec.onspeechend = () => this.onUtteranceEnd?.({ speaker: this.speaker });
    this.rec.onerror = (e) => {
      if (e.error === "no-speech" || e.error === "aborted") return; // routine, Chrome restarts via onend
      this.onError?.(new Error(`Speech recognition: ${e.error}`));
    };
    // Chrome ends continuous sessions after a while; restart until stopped.
    this.rec.onend = () => { if (!this.stopped) { try { this.rec.start(); } catch {} } };
    this.rec.start();
  }

  stop() {
    this.stopped = true;
    try { this.rec?.stop(); } catch {}
    this.rec = null;
  }
}
