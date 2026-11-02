// Audio cursor lag is a transport/model backlog estimate, not microphone-to-screen time.
// Deepgram finals can deliberately end early; measure only interim Results messages.
export function interimBacklogMs(sentSeconds, result) {
  if (result.is_final || !Number.isFinite(sentSeconds) || !Number.isFinite(result.start) || !Number.isFinite(result.duration)) return null;
  const end = result.start + result.duration;
  if (end < 0 || end > sentSeconds + 0.1) return null;
  return Math.max(0, Math.round((sentSeconds - end) * 1000));
}

export function captionSummary(samples = []) {
  const delays = samples.map(s => s.backlogMs).filter(Number.isFinite).sort((a, b) => a - b);
  const render = samples.map(s => s.renderMs).filter(Number.isFinite);
  return { samples: delays.length,
    medianBacklogMs: delays.length ? delays[Math.floor(delays.length / 2)] : null,
    p95BacklogMs: delays.length ? delays[Math.min(delays.length - 1, Math.ceil(delays.length * 0.95) - 1)] : null,
    maxRenderMs: render.length ? Math.max(...render) : null };
}
