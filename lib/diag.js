// Ring buffer of hint-call diagnostics, kept in extension storage and shown in Settings.
export const DIAG_LIMIT = 50;

export function makeEntry({ ms, usage = {}, model, ok = true, error = "" }, now = Date.now()) {
  return {
    t: now, ms: Math.round(ms), model, ok, error: error.slice(0, 120),
    input: usage.input_tokens ?? 0,
    output: usage.output_tokens ?? 0,
    cacheRead: usage.cache_read_input_tokens ?? 0,
    cacheWrite: usage.cache_creation_input_tokens ?? 0,
  };
}

export function pushEntry(list, entry, limit = DIAG_LIMIT) {
  return [...list, entry].slice(-limit);
}

export function summarize(list) {
  const ok = list.filter((e) => e.ok);
  if (!ok.length) return { count: 0, medianMs: 0, cacheHitRate: 0 };
  const sorted = ok.map((e) => e.ms).sort((a, b) => a - b);
  const medianMs = sorted[Math.floor(sorted.length / 2)];
  const cacheHitRate = ok.filter((e) => e.cacheRead > 0).length / ok.length;
  return { count: ok.length, medianMs, cacheHitRate };
}
