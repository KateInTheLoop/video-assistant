// Display preferences are independent of interview settings and captured media.
import { STACK_BELOW_PX } from "./callView.js";

export const LAYOUT_STORAGE_KEY = "coach-layout-v1";
export const LAYOUT_PRESETS = Object.freeze({
  text: Object.freeze({ left: 50, video: 26, call: true, transcript: true }),
  whiteboard: Object.freeze({ left: 64, video: 74, call: true, transcript: true }),
  current: Object.freeze({ left: 64, video: 74, call: true, transcript: true }),
});
export const READING_SIZES = Object.freeze([14, 16, 18, 20]);
export const NARROW_LAYOUT_PX = STACK_BELOW_PX;

export function clampSplit(value, { min, max }) {
  return Math.max(min, Math.min(max, value));
}

// Treat stored data as untrusted: bad values never make a pane unreachable.
export function layoutPreferences(saved) {
  const preferences = { selected: "text", fontSize: 16, views: {} };
  if (typeof saved?.selected === "string" && Object.hasOwn(LAYOUT_PRESETS, saved.selected)) preferences.selected = saved.selected;
  if (READING_SIZES.includes(saved?.fontSize)) preferences.fontSize = saved.fontSize;
  for (const [preset, defaults] of Object.entries(LAYOUT_PRESETS)) {
    const view = saved?.views?.[preset];
    preferences.views[preset] = { ...defaults };
    for (const prop of ["left", "video"]) {
      if (Number.isFinite(view?.[prop])) preferences.views[preset][prop] = clampSplit(view[prop], { min: prop === "left" ? 25 : 15, max: prop === "left" ? 70 : 80 });
    }
    for (const prop of ["call", "transcript"]) {
      if (typeof view?.[prop] === "boolean") preferences.views[preset][prop] = view[prop];
    }
  }
  return preferences;
}

// Percentages include the divider's 10px track. On very short surfaces, relax the
// pixel limits and let each pane scroll rather than overflowing its grid track.
export function splitBounds(size, axis) {
  const column = axis === "left";
  const limits = column ? { min: 25, max: 70 } : { min: 15, max: 80 };
  const first = column ? 300 : 96, last = column ? 400 : 140;
  if (!Number.isFinite(size) || size < first + last + 10) return limits;
  return { min: Math.max(limits.min, first / size * 100), max: Math.min(limits.max, (size - last - 10) / size * 100) };
}

export function layoutVisibility({ selected, view, hasVideo }) {
  const call = !!hasVideo && view.call;
  const transcriptInCoach = selected === "current";
  const media = call || (!transcriptInCoach && view.transcript);
  return { call, media, transcript: view.transcript, transcriptInCoach, rowDivider: call && view.transcript && !transcriptInCoach };
}
