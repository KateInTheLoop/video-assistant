// Time handling shared by the local player and its tests. No extension runtime imports.
export function parseTime(value) {
  const text = String(value).trim();
  if (!/^\d+(?::\d{1,2}){0,2}(?:\.\d{1,3})?$/.test(text)) {
    throw new Error("Use seconds, m:ss or h:mm:ss (decimals are allowed).");
  }
  const parts = text.split(":").map(Number);
  if (parts.slice(1).some(n => n >= 60)) throw new Error("Minutes and seconds after a colon must be below 60.");
  const seconds = parts.reduce((total, part) => total * 60 + part, 0);
  if (!Number.isFinite(seconds)) throw new Error("Enter a valid time.");
  return seconds;
}

export function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const millis = Math.floor(seconds * 1000);
  const whole = Math.floor(millis / 1000);
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor(whole / 60) % 60;
  const fraction = String(millis % 1000).padStart(3, "0").replace(/0+$/, "");
  return `${hours ? hours + ":" + String(minutes).padStart(2, "0") : Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}${fraction ? "." + fraction : ""}`;
}

export function loopRange(from, to, duration) {
  if (!Number.isFinite(duration) || duration <= 0) throw new Error("Wait until the recording's duration is available.");
  const start = parseTime(from), end = parseTime(to);
  if (end > duration || start >= duration) throw new Error("Loop times must be within the recording.");
  if (end - start < 0.25) throw new Error("Loop end must be at least 0.25 seconds after its start.");
  return { start, end };
}

export function seekTarget(time, duration, range = null) {
  if (!Number.isFinite(time) || !Number.isFinite(duration) || duration <= 0) return 0;
  // Stop short of the loop end so an explicit seek doesn't immediately wrap to its start.
  return Math.max(range?.start ?? 0, Math.min(range ? range.end - 0.05 : duration, time));
}

export function loopRestart(time, range, ended = false) {
  return range && (ended || time >= range.end || time < range.start - 0.05) ? range.start : null;
}
