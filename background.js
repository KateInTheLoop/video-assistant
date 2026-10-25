// Opens the coach as a standalone window so it can live on the second monitor.
// The window id is kept in session storage because the service worker is suspended between clicks.

async function existingCoachWindow() {
  const { coachWindowId } = await chrome.storage.session.get("coachWindowId");
  if (coachWindowId == null) return null;
  try { return await chrome.windows.get(coachWindowId); } catch { return null; }
}

chrome.action.onClicked.addListener(async () => {
  const existing = await existingCoachWindow();
  if (existing) {
    await chrome.windows.update(existing.id, { focused: true });
    return;
  }
  const win = await chrome.windows.create({
    url: chrome.runtime.getURL("panel.html"),
    type: "popup",
    width: 1280,  // room for the call's picture beside the coach; "Full screen" in the window fills the monitor
    height: 820,
  });
  await chrome.storage.session.set({ coachWindowId: win.id });
});

chrome.windows.onRemoved.addListener(async (id) => {
  const { coachWindowId } = await chrome.storage.session.get("coachWindowId");
  if (id === coachWindowId) await chrome.storage.session.remove("coachWindowId");
});
