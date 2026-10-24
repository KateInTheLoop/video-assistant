# Interview Coach (Chrome extension)

Live captions for a video interview plus structure hints grounded in the candidate's own CV and stories.
Not an answer generator: hints are capped at a few keywords and may only point at stories you wrote yourself.
The optional "answer shape" panel names what a strong answer covers and the follow-ups to expect; it never writes words to read aloud.

## Install (developer mode)
1. `chrome://extensions` → enable Developer mode → Load unpacked → pick this folder.
2. Click the extension icon → the coach opens as its own window. Drag it to the second monitor.
3. Open Settings (link in the window header): add an Anthropic API key and a Deepgram API key,
   paste the CV and job description, click "Draft stories from CV", edit the stories, Save.

## Use
1. Join the interview in Meet / Zoom web / Teams web in a Chrome tab.
2. In the coach window click **Capture call audio**, choose the meeting *tab* and tick **Share tab audio**.
3. Click **Capture my mic**.
4. Hints appear when the interviewer stops talking. The transcript is saved locally when you Stop.

## Notes
- Tab-audio capture works on every OS. Whole-system audio capture only works on Windows and ChromeOS, so tab capture is the default.
- Speech to text is Deepgram Nova-3 by default (robust to accents, ~300 ms); AssemblyAI Universal-Streaming is available as an alternative/backup provider, selectable in Settings. Claude Opus 5.5 produces the hints with a structured JSON schema.
- Nothing is uploaded except the recent transcript text (to Anthropic) and the audio (to Deepgram).
