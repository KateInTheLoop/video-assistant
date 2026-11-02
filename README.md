# Interview Coach (Chrome extension)

Live captions for a video interview plus structure hints grounded in the candidate's own CV and stories.
Experience questions receive short cues grounded in your own stories and CV. Technical knowledge questions receive concise factual explanations and examples from the model's general knowledge, calibrated to the CV and job. They work without a matching story, including with an empty story bank.
The optional "answer shape" panel names what a strong answer covers and the follow-ups to expect; it never writes words to read aloud.

For a prepared resume opening, choose **Content → Interview guidance and materials → Add
resume summary** and paste your exact answer. It defaults to **This job** and **Must focus**;
use candidate scope for a general answer. An existing note can become a **Resume summary /
prepared answer** through its Material type dropdown without losing its text. Enabled summaries
are available in every context tier. Highest priority wins among summaries; this-job scope
wins ties, then the first saved entry. Off summaries are excluded.

Guidance cards stay visible at the top of Content. Each card names its purpose, scope and
inclusion status; the active resume answer is marked **Selected for resume questions**.
Use **Start → Review interview guidance** to jump there and preview the exact selected answer.
The preview reflects your current settings. Check the saving status before starting a new
interview; a running interview keeps the context it started with.

"Walk me through your resume" or "Tell me about yourself" displays the selected answer
immediately, exactly as saved, without a Claude rewrite. The complete CV timeline is available
under **CV timeline and supporting roles**. Without a prepared answer, the walkthrough shows
generated opening cues and every dated CV role, oldest to newest, with a role slider,
Previous/Next, direct selection and an option to reverse the order. Role dates, employers and
duties come directly from the CV. An unrecognized layout shows the source text for review.

"Tell me about your experience with X" opens a topic-specific storyline with relevant roles
in chronological order, exact CV evidence, connected prepared examples and short cues linking
early exposure, development and recent work to the job. "How many years with Y?" adds dated
evidence: overlapping role windows count once, gaps are excluded, and an employment-window
upper bound is explicitly distinguished from confirmed skill tenure. Undated skills/stories
can still help while duration remains unknown. Related roles suggested by the model require
source quotations and are excluded from the numeric bound. Short follow-ups such as "and
with Workday?" change topic and retain the duration context.

The live coach's maintained instructions are [skills/interview-coach/SKILL.md](skills/interview-coach/SKILL.md).
The extension loads this file once when its window opens and includes its body in every live
Claude system prompt, including cache warmup. The release ZIP includes it. After changing
the skill, close and reopen the coach (or reload the extension) to load the new instructions.
The application supplies the response schema and enforces evidence checks separately.

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
Each live hint receives your enabled coach notes and selected resume summary plus the context chosen in Settings: Lean adds stories and the job description, Standard adds the CV, and Everything adds other enabled materials. Settings → "What the coach sees" estimates each part, including the dated role index and response format. **Count with API** counts a sample hint with an empty transcript; live transcript and interview history add input tokens. Diagnostics show actual cache reads. The coach is also told what has been asked and which stories you confirmed using. Live hints default to Claude Haiku 5.5; drafting stories, the gap report and the debrief use Claude Opus 5.5. Explicit resume requests with a prepared answer are retrieved locally.

In **Interview guidance and materials**, use **Add interview notes** to tell the coach what
you expect: likely technical domains, skills worth emphasizing, and links between your work
and this job. For example: "Expect inventory costing questions; emphasize reconciliations;
connect system-testing experience to this role's migration work." Notes default to **5 — Must
focus**, other materials to **3 — Relevant**. The 0–5 slider adjusts emphasis; **0 — Off** excludes
an item entirely. Cards show the order and whether text is included, shortened or omitted.
Higher priorities receive space first, so background documents do not crowd out important notes.

New notes apply to **This job**. Choose **Candidate — all jobs** for reusable guidance.
Existing notes keep their original scope and receive the highest default priority. Notes
remain included in Lean and Standard unless turned Off; other materials require Everything.
The same ranked guidance goes to story drafting, guided-answer preparation and likely-question
generation. The model is instructed to apply it across technical notes, career overviews,
story choices and follow-ups while answering the actual question and keeping facts grounded.

## CV formats
| Format | How it is read | Leaves the machine? |
|---|---|---|
| PDF | Transcribed once by Claude Haiku (a few seconds, ~2k tokens per page) | The PDF goes to Anthropic once |
| DOCX, ODT | Parsed locally: the ZIP is opened with the browser's own inflater and the XML turned into text | No |
| TXT, MD | Read directly | No |
| .doc, .rtf, .pages, Google Docs | Not readable here: download or save as .docx or PDF first | - |

Whatever the source, the CV becomes plain text in Settings, which you can check and edit. Its dates and responsibilities remain available as evidence alongside the structured story bank. The app requests one-hour caching for the stable prompt prefix. The initial cache write is charged, unchanged context can use cheaper cache reads, and new transcript and answer tokens are billed separately. Changes or cache expiry can require another write.

## Notes
- Tab-audio capture works on every OS. Whole-system audio capture only works on Windows and ChromeOS, so tab capture is the default.
- Speech to text uses Deepgram Nova-3 by default; AssemblyAI Universal-Streaming is available as an alternative provider in Settings. Live hints use the selected Claude model (Haiku by default); preparation and debriefs use Opus.
- Audio goes to the selected speech provider (Deepgram or AssemblyAI). Anthropic receives recent transcript text and the context selected by your tier for live hints; the full transcript and story titles for the debrief; and the CV, job description, typed answer or PDF needed for preparation. DOCX, ODT and text files are parsed locally. Keys and saved transcripts remain in local extension storage.

## Developer mode

Deepgram captions use interim results, `no_delay=true` and roughly 50 ms audio batches.
Live words are marked **live** and update independently of hint generation. No-delay mode
can return less polished number/date formatting. Saved sessions include median/p95 interim
audio-cursor backlog and caption-update duration; these estimates are not total speech-to-screen
latency. Developer traces include `caption.update` samples to help distinguish provider backlog
from local UI work.

Settings → Diagnostics → Developer mode. The coach window then logs trace points to its console
(right-click the window → Inspect): each caption, scheduler decision, hint request, first token,
first partial render, validator drops and errors, with millisecond offsets from the session start.
The status line shows first-token and total time per hint and how long after the interviewer's
speech it arrived, and Save transcript also downloads an `interview-….trace.log`. It changes
nothing about what is sent to Claude.

## Profiles: one candidate, many jobs

Settings has two tabs. **Start** is one screen: keys, speech-to-text provider, live-hint model,
and two dropdowns, **Candidate** and **Job**. **Content** holds everything the coach draws on:
your name, CV, story bank and guided interview, the job title and description, likely questions
and gaps, extra materials, the context table, backup, microphone test, diagnostics and past
sessions.

A candidate holds a name, CV, stories, and materials scoped to that candidate. A job holds a
title, the job description, and materials scoped to that job, including new interview notes. The coach uses
the active pair, so one CV and story bank serve many applications: add a job with **New**,
paste its description, and switch back later without touching your stories. **Duplicate** copies
an entry; **Delete** removes it. Export the active candidate or job as JSON to move it to another
machine; importing adds it as a new entry and makes it active. An install from before profiles
is migrated once into one candidate and one job, with nothing changed about what the coach sees.
Candidate and job selection pauses while drafting, importing, or uploading content, and unlocks
after it is saved, so results always stay with the selected profiles.

## One screen: the call beside the coach

When you share the meeting tab (step 1), its picture appears in a large pane with the coach
beside it; click **Full screen** to fill the monitor. The pane is a mirror of the shared tab:
watch and listen there, but your camera, mute and leave stay in the real meeting tab. **Hide
call** collapses the pane; a narrow window stacks the call above the coach. The mirror is
muted, so the call's audio is never played back. Verified on Chrome; on Linux under Wayland,
check that the tab share offers a picture at all.

## Install from a release

Each tagged version has a ready `.zip` on the repo's Releases page.

1. Download `interview-coach-v<version>.zip` and unzip it.
2. Open `chrome://extensions`, turn on **Developer mode** (top right).
3. Click **Load unpacked** and select the unzipped folder.
4. Open the options page and add your API keys. See `docs/first-run.md`.

## Build and release (maintainers)

- `npm run scan` — hard credential check (also a `pre-push` hook via `npm run hooks`, and in CI).
- `npm test` — unit tests.
- `npm run build` — writes `dist/interview-coach-v<version>.zip`.

CI runs the scan, tests and a build on every push and PR. To cut a release, bump `version` in
`manifest.json` and `package.json`, commit, then push a matching tag:

```
git tag v0.3.0 && git push origin v0.3.0
```

The Release workflow checks the tag matches the manifest, runs the scan and tests, builds the
zip and publishes a GitHub Release with it attached.
