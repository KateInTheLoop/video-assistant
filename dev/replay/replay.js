import { formatTime, loopRange, seekTarget, loopRestart } from "./playback.js";

const $ = id => document.getElementById(id);
const media = $("recording");
let objectURL = null, range = null, duration = 0, generation = 0;

function showError(message = "") {
  $("error").textContent = message;
  $("error").hidden = !message;
}

function resetRange() {
  range = null;
  $("loop").checked = false;
  $("from").value = "0:00";
  $("to").value = formatTime(duration);
  for (const id of ["from", "to"]) $(id).removeAttribute("aria-invalid");
  showError();
}

function applyLoop() {
  range = null;
  for (const id of ["from", "to"]) $(id).removeAttribute("aria-invalid");
  showError();
  try {
    const next = loopRange($("from").value, $("to").value, duration);
    if ($("loop").checked) {
      range = next;
      checkLoop();
    }
  } catch (error) {
    $("loop").checked = false;
    for (const id of ["from", "to"]) $(id).setAttribute("aria-invalid", "true");
    showError(error.message);
  }
}

function seek(time) {
  if (duration) media.currentTime = seekTarget(time, duration, range);
}

function checkLoop() {
  if (media.seeking || media.error) return;
  const restart = loopRestart(media.currentTime, range, media.ended);
  if (restart === null) return;
  const ended = media.ended;
  media.currentTime = restart;
  if (ended) {
    const version = generation;
    media.play().catch(error => { if (version === generation) showError(`Press Play to resume: ${error.message}`); });
  }
}

$("open").addEventListener("click", () => $("file").click());
$("file").addEventListener("change", () => {
  const file = $("file").files[0];
  if (!file) return;
  generation++;
  media.pause();
  media.removeAttribute("src");
  media.load();
  if (objectURL) URL.revokeObjectURL(objectURL);
  objectURL = URL.createObjectURL(file);
  duration = 0;
  resetRange();
  $("transport").disabled = true;
  $("loopControls").disabled = true;
  $("placeholder").hidden = true;
  $("audioLabel").hidden = true;
  $("filename").textContent = file.name;
  $("status").textContent = "Opening recording…";
  media.src = objectURL;
  media.load();
  media.playbackRate = Number($("speed").value);
  $("file").value = "";
});

function updateDuration() {
  if (!Number.isFinite(media.duration) || media.duration <= 0 || media.duration === duration) return;
  duration = media.duration;
  for (const id of ["back", "forward", "restart"]) $(id).disabled = false;
  $("transport").disabled = false;
  $("loopControls").disabled = false;
  resetRange();
}

media.addEventListener("loadedmetadata", () => {
  updateDuration();
  $("transport").disabled = false;
  for (const id of ["back", "forward", "restart"]) $(id).disabled = !duration;
  $("audioLabel").hidden = media.videoWidth > 0;
  $("status").textContent = duration
    ? `Ready · ${formatTime(duration)}. Share this tab with the coach, then press Play.`
    : "Ready. Press Play; section controls will unlock when Chrome determines the duration.";
});
media.addEventListener("durationchange", updateDuration);
media.addEventListener("ratechange", () => { $("speed").value = String(media.playbackRate); });
media.addEventListener("play", () => { $("status").textContent = "Playing. Use the coach to inspect captions and questions."; });
media.addEventListener("pause", () => { if (objectURL && !media.ended && !media.error) $("status").textContent = "Paused. The coach keeps its current session and transcript."; });
media.addEventListener("ended", () => { if (!range) $("status").textContent = "Recording finished. Stop the coach to save this test session."; checkLoop(); });
media.addEventListener("timeupdate", checkLoop);
media.addEventListener("seeked", checkLoop);
media.addEventListener("error", () => {
  if (!objectURL || !media.error) return;
  range = null;
  $("loop").checked = false;
  $("transport").disabled = true;
  $("loopControls").disabled = true;
  $("status").textContent = "Recording could not be played.";
  showError("Chrome could not read this recording. Try a supported codec in MP4, WebM, MP3 or WAV, then open it again.");
});

$("back").addEventListener("click", () => seek(media.currentTime - 10));
$("forward").addEventListener("click", () => seek(media.currentTime + 10));
$("restart").addEventListener("click", () => seek(range?.start ?? 0));
$("speed").addEventListener("change", () => { media.playbackRate = Number($("speed").value); });
$("loop").addEventListener("change", () => {
  if ($("loop").checked) applyLoop();
  else range = null;
});
for (const [field, button] of [["from", "markFrom"], ["to", "markTo"]]) {
  $(field).addEventListener("change", applyLoop);
  $(button).addEventListener("click", () => { $(field).value = formatTime(media.currentTime); applyLoop(); });
}
$("clearLoop").addEventListener("click", resetRange);
window.addEventListener("pagehide", event => { if (!event.persisted && objectURL) URL.revokeObjectURL(objectURL); });
