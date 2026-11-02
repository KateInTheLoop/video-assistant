import { LAYOUT_STORAGE_KEY, LAYOUT_PRESETS, NARROW_LAYOUT_PX, layoutPreferences, layoutVisibility, splitBounds, clampSplit } from "./layout.js";

// Owns only presentation. In particular, never reads or writes the video stream,
// speech connections, interview settings, hint queue or transcript contents.
export function createPanelLayout({ document, window, storage, onChange = () => {} }) {
  const $ = id => document.getElementById(id);
  const stage = $("stage"), media = $("mediaColumn"), captions = $("captions");
  const buttons = { text: $("layoutText"), whiteboard: $("layoutWhiteboard"), current: $("layoutCurrent") };
  let preferences;
  try { preferences = layoutPreferences(JSON.parse(storage().getItem(LAYOUT_STORAGE_KEY))); }
  catch { preferences = layoutPreferences(); }
  let hasVideo = false, drag = null;
  const narrow = () => window.innerWidth < NARROW_LAYOUT_PX;
  const bounds = prop => splitBounds(prop === "left" ? stage.clientWidth : media.clientHeight, prop);
  const scrollers = [$("hint"), $("transcript"), $("questions")];
  const scrollPositions = new Map();

  function finishDrag() {
    if (!drag) return;
    const { divider, pointerId } = drag;
    drag = null;
    stage.classList.remove("resizingColumns", "resizingRows");
    if (divider.hasPointerCapture(pointerId)) divider.releasePointerCapture(pointerId);
    persist();
  }

  function render() {
    // A reflow may change the transcript's parent/height, but keeps its live nodes
    // and current reading position. A reader at the end stays at the end.
    for (const el of scrollers) if (el.clientHeight > 0) scrollPositions.set(el, { top: el.scrollTop, bottom: el.scrollHeight - el.scrollTop - el.clientHeight <= 2 });
    const view = preferences.views[preferences.selected];
    const visible = layoutVisibility({ selected: preferences.selected, view, hasVideo });
    const parent = visible.transcriptInCoach ? $("coach") : media;
    if (captions.parentElement !== parent) parent.appendChild(captions);
    stage.dataset.layout = preferences.selected;
    stage.classList.toggle("mediaHidden", !visible.media);
    stage.classList.toggle("noCall", !visible.call);
    stage.classList.toggle("noTranscript", !visible.transcript);
    stage.classList.toggle("narrowLayout", narrow());
    media.hidden = !visible.media;
    media.classList.toggle("oneMedia", !visible.rowDivider);
    $("callPane").hidden = !visible.call;
    captions.hidden = !visible.transcript;
    $("columnDivider").hidden = !visible.media || narrow();
    $("rowDivider").hidden = !visible.rowDivider || narrow();
    for (const [id, prop] of [["columnDivider", "left"], ["rowDivider", "video"]]) {
      const limits = bounds(prop), value = clampSplit(view[prop], limits), divider = $(id);
      stage.style.setProperty(prop === "left" ? "--left" : "--video", `${value}%`);
      divider.setAttribute("aria-valuemin", String(Math.round(limits.min)));
      divider.setAttribute("aria-valuemax", String(Math.round(limits.max)));
      divider.setAttribute("aria-valuenow", String(Math.round(value)));
      divider.setAttribute("aria-valuetext", prop === "left" ? `${Math.round(value)}% call area, ${Math.round(100 - value)}% coach` : `${Math.round(value)}% call, ${Math.round(100 - value)}% transcript`);
    }
    stage.style.setProperty("--reading-size", `${preferences.fontSize}px`);
    $("readingSize").value = String(preferences.fontSize);
    for (const [preset, button] of Object.entries(buttons)) button.setAttribute("aria-pressed", String(preset === preferences.selected));
    $("btnCall").disabled = !hasVideo;
    $("btnCall").textContent = view.call ? "Hide call" : "Show call";
    $("btnCall").setAttribute("aria-expanded", String(visible.call));
    $("btnTranscript").textContent = view.transcript ? "Hide transcript" : "Show transcript";
    $("btnTranscript").setAttribute("aria-expanded", String(visible.transcript));
    for (const el of scrollers) {
      const position = scrollPositions.get(el);
      if (position && el.clientHeight > 0) el.scrollTop = position.bottom ? el.scrollHeight : position.top;
    }
  }

  function persist() {
    try { storage().setItem(LAYOUT_STORAGE_KEY, JSON.stringify(preferences)); $("layoutStatus").textContent = ""; }
    catch { $("layoutStatus").textContent = "Layout applies to this window; saving is unavailable."; }
    onChange(preferences.selected);
  }

  function reset(prop) {
    finishDrag();
    const selected = preferences.selected;
    if (prop) preferences.views[selected][prop] = LAYOUT_PRESETS[selected][prop];
    else preferences.views[selected] = { ...LAYOUT_PRESETS[selected] };
    render(); persist();
  }

  for (const [preset, button] of Object.entries(buttons)) button.onclick = () => {
    finishDrag(); preferences.selected = preset; render(); persist();
  };
  $("readingSize").onchange = () => {
    preferences.fontSize = layoutPreferences({ fontSize: Number($("readingSize").value) }).fontSize;
    render(); persist();
  };
  $("btnCall").onclick = () => { const view = preferences.views[preferences.selected]; view.call = !view.call; render(); persist(); };
  $("btnTranscript").onclick = () => { const view = preferences.views[preferences.selected]; view.transcript = !view.transcript; render(); persist(); };
  $("btnLayoutReset").onclick = () => reset();

  for (const [id, prop] of [["columnDivider", "left"], ["rowDivider", "video"]]) {
    const divider = $(id);
    divider.onpointerdown = event => {
      if (narrow() || event.button !== 0) return;
      finishDrag();
      drag = { divider, pointerId: event.pointerId, rect: (prop === "left" ? stage : media).getBoundingClientRect() };
      divider.setPointerCapture(event.pointerId);
      divider.focus(); stage.classList.add(prop === "left" ? "resizingColumns" : "resizingRows");
      event.preventDefault();
    };
    divider.onpointermove = event => {
      if (!drag || drag.divider !== divider || drag.pointerId !== event.pointerId) return;
      const { rect } = drag;
      const value = prop === "left" ? (event.clientX - rect.left - 5) / rect.width * 100 : (event.clientY - rect.top - 5) / rect.height * 100;
      preferences.views[preferences.selected][prop] = clampSplit(value, bounds(prop));
      render();
    };
    divider.onpointerup = divider.onpointercancel = divider.onlostpointercapture = finishDrag;
    divider.ondblclick = () => reset(prop);
    divider.onkeydown = event => {
      if (narrow()) return;
      const previous = prop === "left" ? "ArrowLeft" : "ArrowUp", next = prop === "left" ? "ArrowRight" : "ArrowDown";
      if (![previous, next, "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const limits = bounds(prop);
      const value = event.key === "Home" ? limits.min : event.key === "End" ? limits.max : Number(divider.getAttribute("aria-valuenow")) + (event.key === previous ? -1 : 1) * (event.shiftKey ? 5 : 2);
      preferences.views[preferences.selected][prop] = clampSplit(value, limits);
      render(); persist();
    };
  }

  render();
  return { update({ hasVideo: liveVideo }) { finishDrag(); hasVideo = liveVideo; render(); } };
}
