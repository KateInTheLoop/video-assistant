// Session trace points: what happened when, relative to the session start. Pure ring buffer;
// the panel decides whether to log to the console (developer mode) and saves the buffer next
// to the transcript. Stays cheap when disabled: a mark is a push into an array.
export const TRACE_MAX = 2000;

export function createTrace({ now = () => Date.now(), max = TRACE_MAX, onMark = null } = {}) {
  const entries = [];
  let t0 = now();
  return {
    entries,
    reset() { entries.length = 0; t0 = now(); },
    mark(event, data = {}) {
      const e = { t: now() - t0, event, ...data };
      entries.push(e);
      if (entries.length > max) entries.splice(0, entries.length - max);
      onMark?.(e);
      return e;
    },
    // Time since the last mark of a given event, or null. Lets the panel measure e.g. STT final -> hint shown.
    since(event) {
      for (let i = entries.length - 1; i >= 0; i--) if (entries[i].event === event) return now() - t0 - entries[i].t;
      return null;
    },
  };
}

// One line per entry, grep-friendly: "+12345ms hint.done ms=2114 cached=true".
export function formatTrace(entries) {
  return entries.map((e) => {
    const { t, event, ...rest } = e;
    const kv = Object.entries(rest).map(([k, v]) => `${k}=${typeof v === "string" ? JSON.stringify(v) : v}`).join(" ");
    return `+${String(t).padStart(6)}ms ${event}${kv ? " " + kv : ""}`;
  }).join("\n");
}
