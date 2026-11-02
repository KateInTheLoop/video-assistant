export const QUESTION_MODE_KEY = "coach-question-mode-v1";
export const questionMode = value => value === "manual" ? "manual" : "auto";
export const captureText = value => typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, 4000) : "";
export const sameCapture = (a, b) => captureText(a).replace(/[?.!,;:]+$/, "").trim().toLowerCase() === captureText(b).replace(/[?.!,;:]+$/, "").trim().toLowerCase();

// Keep the current interviewer utterance, including live words not finalized yet.
// A captured interim and its later final share one key, so Space cannot duplicate it.
export class QuestionCaptureBuffer {
  constructor() { this.reset(); }
  reset() { this.sequence = 0; this.final = ""; this.interim = ""; this.closed = true; this.endAfterFinal = false; }
  speech({ speaker, text, final = false, speechFinal = false }) {
    if (speaker !== "interviewer") { this.end(); return; }
    if (!captureText(text)) return;
    if (this.closed) { this.sequence++; this.final = ""; this.interim = ""; this.closed = false; this.endAfterFinal = false; }
    if (final) { this.final = `${this.final} ${text}`.replace(/\s+/g, " ").trim().slice(-4000); this.interim = ""; this.closed = speechFinal || this.endAfterFinal; this.endAfterFinal = false; }
    else this.interim = text;
  }
  end() { if (this.interim) this.endAfterFinal = true; else this.closed = true; }
  snapshot() {
    const text = captureText(`${this.final} ${this.interim}`.slice(-4000));
    return text ? { text, key: `turn:${this.sequence}` } : null;
  }
}

// Space is a coach-window shortcut, never a global meeting shortcut. Preserve native
// keyboard behavior in controls, editors and splitters, and ignore held/repeated keys.
export function captureShortcut(event) {
  if (event.defaultPrevented || event.repeat || event.isComposing || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return false;
  if (event.code !== "Space" && event.key !== " ") return false;
  const target = event.target;
  if (target?.isContentEditable || /^(INPUT|TEXTAREA|SELECT|BUTTON|A|SUMMARY)$/.test(target?.tagName || "")) return false;
  return !target?.closest?.("button, a, input, textarea, select, summary, [contenteditable]:not([contenteditable=false]), [role=button], [role=separator], [role=slider]");
}
