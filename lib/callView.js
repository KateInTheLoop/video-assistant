// The stage: the captured call shown beside the coach. Pure helpers so the decisions are
// testable without a browser; panel.js owns the DOM.

// Chrome only offers "Share tab audio" when video is requested too, so the capture always
// carries a video track when the user picked a tab. We used to stop it; now it is the picture.
export function callTracks(stream) {
  const audio = stream?.getAudioTracks?.() || [];
  const video = stream?.getVideoTracks?.() || [];
  return { audio: audio[0] || null, video: video[0] || null };
}

// Show the call pane when there is a live picture and the user has not hidden it.
export function showCallPane({ hasVideo, hidden = false }) {
  return !!hasVideo && !hidden;
}

// Side by side when there is room, stacked (call on top) when the window is narrow.
export const STACK_BELOW_PX = 900;
export function stageLayout({ width, withCall }) {
  if (!withCall) return "coach-only";
  return width < STACK_BELOW_PX ? "stacked" : "side-by-side";
}
