// Decides when to actually send a hint request. Pure state machine so it is testable:
// coalesces interviewer fragments, never fires twice within MIN_GAP_MS, never overlaps in-flight calls.
import { shouldAskForHint } from "./question.js";

export const MIN_GAP_MS = 2000;
export const RETRY_AFTER_INFLIGHT_MS = 300;

export class HintScheduler {
  constructor({ minGapMs = MIN_GAP_MS } = {}) {
    this.minGapMs = minGapMs;
    this.pending = "";
    this.inFlight = false;
    this.lastFiredAt = -Infinity;
  }

  // Interviewer said something final. Returns {fireInMs} or null (nothing to schedule yet).
  onInterviewerFinal({ text, speechFinal }, now) {
    const decision = shouldAskForHint({ text, speechFinal, pendingText: this.pending });
    this.pending = `${this.pending} ${text}`.trim();
    if (!decision.ask) return null;
    return { fireInMs: this._gate(decision.delayMs, now) };
  }

  // Deepgram UtteranceEnd: a real pause. Fire if anything is pending.
  onUtteranceEnd(now) {
    if (!this.pending) return null;
    return { fireInMs: this._gate(0, now) };
  }

  // Called when a timer fires. Returns the text to send, or null if it must not fire now.
  take(now) {
    if (this.inFlight || !this.pending) return null;
    if (now - this.lastFiredAt < this.minGapMs) return null;
    const text = this.pending;
    this.pending = "";
    this.inFlight = true;
    this.lastFiredAt = now;
    return text;
  }

  // Call completed. Returns {fireInMs} if speech piled up meanwhile.
  done(now) {
    this.inFlight = false;
    if (!this.pending) return null;
    return { fireInMs: this._gate(RETRY_AFTER_INFLIGHT_MS, now) };
  }

  // Candidate started answering: whatever is pending was not a question, drop it.
  onCandidateSpeaks() { this.pending = ""; }

  // How long until the gap gate opens again.
  nextDelay(now) { return this._gate(0, now); }

  _gate(delayMs, now) {
    const sinceLast = now - this.lastFiredAt;
    return Math.max(delayMs, this.minGapMs - sinceLast, 0);
  }
}
