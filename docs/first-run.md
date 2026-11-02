# First run (Windows or Linux, Chrome)

Fifteen minutes the first time, two minutes on interview day.

## 1. Install the extension
1. Open `chrome://extensions`.
2. Toggle **Developer mode** (top right).
3. **Load unpacked** → choose the `interview-coach` folder.
4. Pin the extension: puzzle icon in the toolbar → pin **Interview Coach**.

On Windows, download the release ZIP and use **Extract All** first. Select the extracted
folder containing `manifest.json` and keep that folder in place after installation.
No Node.js or build tools are needed. If Windows blocks the microphone, enable Chrome
under Windows Settings → Privacy & security → Microphone → desktop app access.

_Screenshot placeholder: extensions page with the card loaded, no errors._

If the card shows **Errors**, click it and paste the text into `STATE.md` → "Human feedback".

## 2. Keys and prep (once)
1. Click the extension icon. The coach opens as its own window. Drag it to the second monitor.
2. Click **Settings** in the window header.
3. Paste the **Anthropic API key** and the **Deepgram API key**. Deepgram: sign up at deepgram.com, create a key, free credit included.
4. Click **Test microphone** and allow the mic when Chrome asks. This is the one permission prompt.
5. Select the candidate and job on Start, then open **Content**. **Interview guidance and materials** is at the top and stays visible. Use **Add interview notes** for expected topics, skills to highlight and role connections. Use **Add resume summary** for wording you want shown verbatim. Both default to **5 — Must focus** and **This job**. Choose **Candidate — all jobs** for reusable guidance; 0 turns an item Off. Card headings, status badges and the **Material type** field show how each item is used.
6. Click **Upload CV** and pick your PDF, DOCX, ODT, TXT or MD file (or paste the text). A PDF takes a few seconds while Claude transcribes it; other formats are instant and never leave the machine. From Google Docs or an old .doc: File → Download → Microsoft Word (.docx) first. Check the text reads right, then paste the **job description** and click **Draft stories from CV**. Your notes can now guide preparation too.
7. Edit each story until it sounds like you. Delete anything that is not true.
8. Answer the **Guided story interview** questions you have real stories for. Skip the rest.
9. Click **Find likely questions and gaps**. Add stories for any ⚠ lines you can.
10. Click **Save settings**. Export both the candidate and the job as JSON to keep the CV, stories, notes and prepared answer; job-scoped guidance travels with the job export.

_Screenshot placeholder: Settings with story bank and gap list._

## 3. Interview day

In Settings, check the candidate and job, then use **Start → Review interview guidance**.
The selected answer is marked **Selected for resume questions**; open its preview to check
the exact wording. This reflects the current settings; confirm they are saved before starting.
Edits made during a running interview apply to the next one.

1. Join the call in a Chrome **tab** (Meet, Zoom web or Teams web). Not the desktop app.
2. In the coach window click **1. Capture call audio**.
   In Chrome's picker choose **Chrome Tab**, select the meeting tab, tick **Share tab audio**, click Share.
   On Linux, "Entire screen" has no audio. If the status says "No audio in that share", redo this step.
3. Click **2. Capture my mic**.
4. Status should read "Mic live. Good luck." Captions appear as people speak.

_Screenshot placeholder: Chrome share picker with Chrome Tab selected and the audio checkbox ticked._

Wear headphones. Without them the mic hears the interviewer through your speakers and their words show up as yours.

## 4. During the call
- **Questions → Automatic** detects questions as before. Choose **Manual** if background
  speech is producing unwanted questions: captions continue, but coaching starts only for
  questions you capture. Click **Capture question** or press **Space** in the focused coach
  window to capture the latest interviewer utterance. Space respects typing and native
  controls. Click a transcript line, or select just the question text and use Space/the
  button, to coach that exact selection. The mode is remembered across coach windows.
- Question cards have colored, labeled states: **New** (blue), **Answering** (green),
  **Postponed** (amber), and **Skipped** (gray). Use **Answer now**, **Postpone**, or **Skip**
  directly on a card. **Done** marks it answered; **Answer now** resumes a postponed/skipped
  card. Captures appear before coaching is ready, and late hints keep your selected card.
  If coaching fails, use **Retry coaching** on the card or hint. **Done** remains separate,
  so you can finish an answer without retrying. Queue updates preserve keyboard focus.
- Choose **Text-heavy**, **Whiteboard**, or **Current** in the coach header. Text-heavy starts
  with a small call above the transcript and a wide answer column. Whiteboard enlarges the
  shared picture; Current keeps the previous arrangement. Drag dividers in wide windows,
  adjust **Text** size, or hide a pane. Focus a divider and use arrow keys for keyboard resizing;
  double-click to reset it, or use **Reset layout** for the whole preset. Your adjustments and
  last layout are remembered. Switching views keeps audio capture and captions running.
- The big line is the question, restated. Technical questions show factual **Technical notes**, including explanations and small examples. Experience questions show up to three of your stories with cues and up to six keywords.
- **Used this story** confirms that you actually drew on a suggested story. Unconfirmed suggestions do not count as used.
- To prepare that opening, use **Content → Interview guidance and materials → Add resume summary**.
  Paste your exact answer, keeping **This job** for a tailored version. You can also change an
  existing note's Material type to **Resume summary / prepared answer**; its text is retained.
- "Walk me through your resume" or "Tell me about yourself" shows that prepared answer
  immediately and verbatim. Expand **CV timeline and supporting roles** for more detail.
  Without a prepared answer, the complete **Career walkthrough** shows an opening overview,
  all dated roles from the CV, a slider and Previous/Next buttons. Click any role to jump to it;
  use the Order dropdown to switch between oldest-first and newest-first. Read the first few
  responsibilities on each card and open **More from this role** for the remaining CV details.
- "Tell me about your experience with X" filters the timeline to that topic, shows exact CV
  evidence and related prepared stories, and adds cues for one connected narrative. Years-of-
  experience questions show a caveated employment-window bound rather than inventing continuous
  skill tenure; undated skills remain visible with unknown duration.
- Keywords are prompts for your own words, never a script. Look at them, then look back at the camera.
- The talk timer warns at 90 seconds and again at two minutes.
- "follow-up, same story" means stay on the story you were telling.

## 5. After the call
1. Click **Stop**. The transcript is saved locally and a debrief is written.
2. Open **Settings → Content tab → Past sessions** (collapsed at the bottom): overall note, the one thing to practise, and per question which STAR parts you hit and how long you talked.
3. Check **Diagnostics**: median hint latency and cache hit rate. Cache hits should be near 100 % after the first hint of a session.

## Troubleshooting
| Symptom | Fix |
|---|---|
| "Chrome blocked the microphone" | Settings → Content tab → Microphone test, allow, then retry |
| "No audio in that share" | Pick **Chrome Tab**, not screen or window, and tick Share tab audio |
| "Deepgram connection failed" | Check the key; the extension retries 3 times on drops |
| Hints slow (> 3 s) | Settings → Start tab → Live hint model → Haiku 5.5 |
| Hint card never updates | Open the coach window's DevTools (right click → Inspect) and look for "hint validator" warnings |
| Nothing works, no error | Reload the extension on `chrome://extensions` and reopen the coach window |

Audio is sent to the selected speech provider. Anthropic receives recent transcript text and
the selected candidate/job context for live hints, and the full transcript plus story titles
for the debrief when you stop. Preparation sends the CV, job description, typed answer or
PDF required for that operation. DOCX, ODT and text files are parsed locally. Final transcript
lines are checkpointed locally; after an interrupted call, reopening the coach recovers them
into Past sessions without uploading a debrief. The active interview keeps its starting
candidate/job context; profile changes apply to the next interview.
