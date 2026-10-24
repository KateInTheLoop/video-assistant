# First run (Linux, Chrome)

Fifteen minutes the first time, two minutes on interview day.

## 1. Install the extension
1. Open `chrome://extensions`.
2. Toggle **Developer mode** (top right).
3. **Load unpacked** → choose the `interview-coach` folder.
4. Pin the extension: puzzle icon in the toolbar → pin **Interview Coach**.

_Screenshot placeholder: extensions page with the card loaded, no errors._

If the card shows **Errors**, click it and paste the text into `STATE.md` → "Human feedback".

## 2. Keys and prep (once)
1. Click the extension icon. The coach opens as its own window. Drag it to the second monitor.
2. Click **Settings** in the window header.
3. Paste the **Anthropic API key** and the **Deepgram API key**. Deepgram: sign up at deepgram.com, create a key, free credit included.
4. Click **Test microphone** and allow the mic when Chrome asks. This is the one permission prompt.
5. Click **Upload CV** and pick your PDF, DOCX, ODT, TXT or MD file (or paste the text). A PDF takes a few seconds while Claude transcribes it; other formats are instant and never leave the machine. From Google Docs or an old .doc: File → Download → Microsoft Word (.docx) first. Check the text reads right, then paste the **job description** and click **Draft stories from CV**.
6. Edit each story until it sounds like you. Delete anything that is not true.
7. Answer the **Guided story interview** questions you have real stories for. Skip the rest.
8. Click **Find gaps for this job**. Add stories for any ⚠ lines you can.
9. Click **Save**. Click **Export story bank** and keep the file.

_Screenshot placeholder: Settings with story bank and gap list._

## 3. Interview day
1. Join the call in a Chrome **tab** (Meet, Zoom web or Teams web). Not the desktop app.
2. In the coach window click **1. Capture call audio**.
   In Chrome's picker choose **Chrome Tab**, select the meeting tab, tick **Share tab audio**, click Share.
   On Linux, "Entire screen" has no audio. If the status says "No audio in that share", redo this step.
3. Click **2. Capture my mic**.
4. Status should read "Mic live. Good luck." Captions appear as people speak.

_Screenshot placeholder: Chrome share picker with Chrome Tab selected and the audio checkbox ticked._

Wear headphones. Without them the mic hears the interviewer through your speakers and their words show up as yours.

## 4. During the call
- The big line is the question, restated. Below it: up to two of your stories with a cue, and up to four keywords.
- Keywords are prompts for your own words, never a script. Look at them, then look back at the camera.
- The talk timer warns at 90 seconds and again at two minutes.
- "follow-up, same story" means stay on the story you were telling.

## 5. After the call
1. Click **Stop**. The transcript is saved locally and a debrief is written.
2. Open **Settings → Past sessions**: overall note, the one thing to practise, and per question which STAR parts you hit and how long you talked.
3. Check **Diagnostics**: median hint latency and cache hit rate. Cache hits should be near 100 % after the first hint of a session.

## Troubleshooting
| Symptom | Fix |
|---|---|
| "Chrome blocked the microphone" | Settings → Test microphone, allow, then retry |
| "No audio in that share" | Pick **Chrome Tab**, not screen or window, and tick Share tab audio |
| "Deepgram connection failed" | Check the key; the extension retries 3 times on drops |
| Hints slow (> 3 s) | Settings → model → Haiku 5.5 |
| Hint card never updates | Open the coach window's DevTools (right click → Inspect) and look for "hint validator" warnings |
| Nothing works, no error | Reload the extension on `chrome://extensions` and reopen the coach window |

Nothing leaves this computer except: audio to Deepgram for transcription, and the recent transcript lines plus your story bank to Anthropic for hints and the debrief.
