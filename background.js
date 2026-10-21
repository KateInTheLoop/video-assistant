// Opens the coach as a standalone window so it can live on the second monitor.
let coachWindowId = null;

chrome.action.onClicked.addListener(async () => {
  if (coachWindowId !== null) {
    try {
      await chrome.windows.update(coachWindowId, { focused: true });
      return;
    } catch { coachWindowId = null; }
  }
  const win = await chrome.windows.create({
    url: chrome.runtime.getURL("panel.html"),
    type: "popup",
    width: 520,
    height: 900,
  });
  coachWindowId = win.id;
});

chrome.windows.onRemoved.addListener((id) => {
  if (id === coachWindowId) coachWindowId = null;
});
