# Interview Coach (Chrome extension)

Live captions for a video interview plus structure hints grounded in the candidate's own CV and stories.
Not an answer generator: hints are capped at a few keywords and may only point at stories you wrote yourself.
The optional "answer shape" panel names what a strong answer covers and the follow-ups to expect; it never writes words to read aloud.

## Install (developer mode)
1. `chrome://extensions` → enable Developer mode → Load unpacked → pick this folder.
2. Click the extension icon → the coach opens as its own window. Drag it to the second monitor.
3. Open Settings (link in the window header): add an Anthropic API key and a Deepgram API key,
   upload the CV or paste it, paste the job description, click "Draft stories from CV", edit the stories.

## Use
1. Join the interview in Meet / Zoom web / Teams web in a Chrome tab.
2. In the coach window click **Capture call audio**, choose the meeting *tab* and tick **Share tab audio**.
3. Click **Capture my mic**.
4. Hints appear when the interviewer stops talking. The transcript is saved locally when you Stop.

## What the coach knows
Every live hint carries, in a cached prefix: your story bank, the job description, your CV, and any extra materials you add (cover letter, LinkedIn profile, company research, notes). A "How much the coach sees" dropdown in Settings picks Lean (stories + job), Standard (+ CV) or Everything (+ materials); Settings → "What the coach sees" shows the size of each part and whether it is above the cache minimum. The coach is also told what has been asked so far and which stories were used, so it steers you away from repeating one. Live hints default to Claude Haiku 5.5 (fastest, cheapest); drafting stories, the gap report and the debrief always use Claude Opus 5.5.

## CV formats
| Format | How it is read | Leaves the machine? |
|---|---|---|
| PDF | Transcribed once by Claude Haiku (a few seconds, ~2k tokens per page) | The PDF goes to Anthropic once |
| DOCX, ODT | Parsed locally: the ZIP is opened with the browser's own inflater and the XML turned into text | No |
| TXT, MD | Read directly | No |
| .doc, .rtf, .pages, Google Docs | Not readable here: download or save as .docx or PDF first | - |

Whatever the source, the CV becomes compact plain text in Settings, which you can check and edit. Plain text rather than JSON on purpose: a CV has no structure worth the ~30% token overhead, and the structured artefact is the story bank. The text sits in the cached prompt prefix, so it costs full price only on the first hint of a session.

## Notes
- Tab-audio capture works on every OS. Whole-system audio capture only works on Windows and ChromeOS, so tab capture is the default.
- Speech to text is Deepgram Nova-3 by default (robust to accents, ~300 ms); AssemblyAI Universal-Streaming is available as an alternative/backup provider, selectable in Settings. Claude Opus 5.5 produces the hints with a structured JSON schema.
- Nothing is uploaded except the recent transcript text (to Anthropic) and the audio (to Deepgram).
