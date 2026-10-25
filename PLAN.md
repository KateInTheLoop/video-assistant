# Interview Coach — plan v2 (post-MVP)

Target: **Linux + Chrome**, used in real interviews. The MVP plan (M0–M6) is complete and was
verified in three real calls; its node table stays in STATE.md for history. This plan picks up
from what those calls taught us.

## How the agent works this plan (one tick = one 20-minute pass)

1. Read `STATE.md`. Pick the first node whose status is `todo` and whose `deps` are all `done`.
   If a node is `blocked`, skip it and note why in STATE.md.
2. Implement only that node. Keep changes small enough to finish in one tick; if not, split it
   into sub-nodes in STATE.md and finish the first.
3. Verify with the node's **Done when** check. `node --check` every changed JS file, `npm test`,
   `npm run scan` (clean before any push, see CLAUDE.md).
4. Update STATE.md (status, one-line note, blockers), commit, push the feature branch.
5. Stop. Do not start a second node in the same tick unless the first took under 5 minutes.

Rules that do not change: hints are keywords, structure prompts and the candidate's own
stories, never full answers. Nothing leaves the machine except the recent transcript lines sent
to Claude. Everything the user enters (profiles included) lives in `chrome.storage.local`. Pure
logic lives in `lib/` with tests; browser glue is not unit-tested. Vanilla JS, no bundler.
Synthetic fixtures only; never a real key, CV, transcript or email in a tracked file.

## Node graph

```
R0 Stage ──► R1 Profiles + two-tab Settings ──► R2 Import from ai-job-search ──► R4 Practice mode
R3 STT head-to-head (independent of R1–R4)
W1 Windows system audio (independent; needs a Windows machine)
```

### R0 — Stage: the call's picture beside the coach (deps: none)
- R0.1 Keep the tab share's video track and show it in a pane beside the coach; side by side
  when wide, stacked under 900 px; Hide call; Full screen; muted mirror. **Done** (v0.2.0).
- R0.2 **Needs human:** confirm the tab share offers a picture on this Linux box (Wayland can
  refuse), and that resizing and full screen never crash the window. Fix what is reported.

### R1 — Profiles and a two-tab Settings page (deps: R0)
Goal: one project per candidate, per job, or both. A session picks one candidate and one job.
- R1.1 `lib/profiles.js` (pure): data model `{ candidates: {id: {name, cvText, stories, resources}},
  jobs: {id: {title, jobDescription, resources}}, activeCandidate, activeJob }`;
  `flatten(profiles)` returns today's flat settings (`cvText`, `stories`, `jobDescription`,
  `resources` = candidate + job materials) so `panel.js`, `hintRequest.js` and the tiers do not
  change; `migrate(flatSettings)` turns the current flat fields into one "Default" candidate and
  one "Default" job. Tests: flatten, migrate idempotent, switching active ids.
- R1.2 `storage.js`: `loadSettings()` returns keys/provider/model/tier plus the flattened active
  profiles; `saveSettings` writes into the active profiles. Existing users migrate once on load.
  Done when: a panel session after migration behaves exactly as before (same context report).
- R1.3 Settings tab **Start** (super simple): Anthropic key, STT provider + key, live-hint model,
  "Candidate ▾" and "Job ▾" dropdowns with New / Rename / Duplicate / Delete, the key-status
  line, and the "What the coach sees" total as one number. Nothing else.
- R1.4 Settings tab **Content**: "About you" (name, CV upload/paste, story bank with draft /
  guided interview, materials: LinkedIn, notes) and "About the job" (title, job description,
  materials: cover letter, company research, likely questions + gap report). Tier dropdown and
  the full context table live here. Done when: every existing control is reachable on exactly
  one tab and the Start tab fits one screen at 1280×800 without scrolling.
- R1.5 Export / import one candidate or one job as JSON (extend `lib/bank.js` round-trip tests).

### R2 — Import a profile from ai-job-search (deps: R1)
The user's `lib/parseAiJobSearch.js` parses `CLAUDE.md` (identity, languages, education,
experience, skills), `07-interview-prep.md` (STAR stories), plus behavioral, writing-style and
job-evaluation files.
- R2.1 Commit the parser with tests on synthetic fixture text (a fake "Alice Chen"-style profile
  with placeholders, two STAR stories, one table). Fix any regex that the fixture breaks.
- R2.2 **Import profile** button on the Content tab: pick the files (multi-select or a folder)
  → new candidate profile: `name`; `stories` from STAR entries (`tags` joined to a string, as the
  bank expects, `source: "import"`); `cvText` rendered from experience / education / skills /
  languages in the same compact plain text the CV upload produces; materials: LinkedIn headline
  as `linkedin`, traits / strengths / growth areas as `notes`. Job-evaluation framework → a
  `notes` material on the job side if the user picks a job.
- R2.3 Preview before save: counts (stories, experience entries, materials), the
  `validateParsedProfile` errors, and a "merge into existing candidate" option (reuse
  `mergeStories`). Done when: a synthetic fixture imports into a fresh candidate and the hint
  context report shows the stories and CV.

### R3 — STT head-to-head, made objective (deps: none; needs one real call)
- R3.1 "Compare providers" toggle in the coach: run Deepgram and AssemblyAI on the same tab
  audio for a session; only the primary drives captions and hints, the secondary only logs.
- R3.2 `lib/sttCompare.js` (pure): per utterance, final latency (audio end → final) and a word
  diff between the two finals; cost per hour from each provider's published rate. Tests.
- R3.3 Diagnostics shows the comparison; the user picks the default. Done when: one real call
  produces a table and STATE records the choice.

### R4 — Practice mode (deps: R2)
- R4.1 Claude as interviewer: questions from the gap report and likely questions for the active
  job; spoken with browser speech synthesis; the candidate answers into the mic.
- R4.2 Same hint pipeline and queue as a real call, so the candidate practises with the coach.
- R4.3 Debrief at the end (existing `claude.debrief`), stored like a real session and marked
  practice. Done when: a full practice run yields a debrief in Past sessions.

### W1 — Windows system audio (deps: none; needs Windows)
- `getDisplayMedia` screen share with system audio (Windows/ChromeOS), fallback to tab audio.
  UI copy branches on platform. Test on Windows.

## Exit criteria v2
- [ ] R0.2 confirmed by the user on Linux (picture shows, no crash on resize/full screen).
- [ ] R1: Start tab fits one screen; switching candidate or job changes the context report.
- [ ] R2: a synthetic ai-job-search fixture imports end to end.
- [ ] Time to first useful content (question + stories on the card) under 1.5 s median on
  Haiku with a warm cache, measured from the trace log.
- [ ] `npm test` and `npm run scan` green on every push; a tagged release per milestone.

## Done in this cycle (reference, outside the original MVP plan)
Autosave settings with validation and key tests; AssemblyAI provider; question queue with
answering / answered / moved-on; answer shape + follow-ups; per-question story gaps; CV upload
(PDF, DOCX, ODT, TXT, MD); extra materials + context tiers; Haiku for live hints, Opus for prep;
streaming hints with progressive render; cache prewarm; trace points + developer mode; secret
scanner + pre-push hook + CI; tagged releases (v0.1.0); the stage (v0.2.0).
