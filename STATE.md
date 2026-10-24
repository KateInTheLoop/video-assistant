# STATE — updated by the agent every tick

## Status (todo | doing | done | blocked)
| Node | Status | Note |
|---|---|---|
| M0.1 | done | git initialised, first commit |
| M0.2 | done | package.json + node --test, smoke test |
| M0.3 | done | Google Chrome 156.0.8078.47 installed on Linux (t14), 2026-10-20 |
| M1.1 | done | lib/transcript.js + 4 tests; panel rewire pending in M1.4 |
| M1.2 | done | lib/question.js + 5 tests (fillers, ?, speech_final, pause delay) |
| M1.3 | done | lib/hintSchema.js: HINT_SCHEMA + validateHint (filters bad keywords/unknown stories), 6 tests |
| M1.4 | done | panel.js/claude.js import lib/*; hints failing validateHint are discarded (console.warn lists reasons) |
| M2.1 | done | stt.js reconnects 1s/2s/4s while media track is live; lib/backoff.js tested; status shown in panel |
| M2.2 | done | NotAllowedError in popup → link to options.html#mic; Settings has Test microphone button |
| M2.3 | done | webspeech.js: Chrome built-in recognition for mic when no Deepgram key; interviewer still needs Deepgram |
| M2.4 | done | panel.html idle status + silent-share error + README all say: Chrome Tab, tick Share tab audio |
| M3.1 | done | lib/hintRequest.js (pure request builder, test proves stable cached prefix), lib/diag.js ring buffer, Settings → Diagnostics shows latency + cache reads. Live cache-hit confirmation still needs a real run (M6.1) |
| M3.2 | done | lib/scheduler.js HintScheduler: coalesce fragments, 2 s min gap, no overlap, candidate speech clears pending; 5 tests; panel uses it |
| M3.3 | done | follow_up flag in schema/validator; last hint passed in user message (cache prefix unchanged, tested); panel tags follow-ups |
| M3.4 | done | isKeyword(): ≤3 words, no punctuation, no I/you/we, no say/mention/explain; prompt rule matches; tests |
| M3.5 | done | Settings model dropdown: opus-5-5 (default) / sonnet-5-5 / haiku-5-5, stored and used by getHint |
| M4.1 | done | lib/storyInterview.js (10 questions, strict schema, nextIndex), claude.storyFromAnswer, Settings guided interview UI; stories tagged source=interview/cv |
| M4.2 | done | claude.gapReport → likely questions as {q, story|null}, ⚠ marker + count for gaps; titles validated against bank |
| M4.3 | done | lib/bank.js export/import/merge with round-trip tests; Settings → Backup buttons |
| M5.1 | done | claude.debrief (per-question story used, STAR flags, went well, improve; overall + top_fix) runs after Stop, stored on session, rendered in Settings → Past sessions |
| M5.2 | done | lib/pace.js answerStats/paceSummary (long >120s, short <20s, wpm), 3 tests; shown per session and per question |
| M6.1 | blocked | needs human: load extension in Chrome, run a Meet test call |
| M6.2 | done | docs/first-run.md: install, prep, interview day, after, troubleshooting table; screenshot placeholders |

## Needs human
- M6.1: all code milestones are done. Load the extension unpacked (chrome://extensions → Developer mode → Load unpacked → this folder), add Anthropic + Deepgram keys in Settings, run a short Meet test call, then paste console errors/observations under "Human feedback". Check Settings → Diagnostics for non-zero cache reads on the second hint (M3.1 live confirmation).

## Human feedback
- 2026-10-24 (session 2, after a second real call): "Answer this" never settled, and stories felt thin. Fixed: (1) an "answering" question flips to "answered" by itself when the next genuinely new question arrives after the candidate has spoken (lib/questionQueue.js settleAnswering), a ✓ on the row and a second tap on the chip do it by hand, and answered rows sink below live ones, above moved-on ones; (2) Move on keeps dropping to the bottom and every sunk row has an explicit "↺ Bring back" that reselects it; (3) richer hints within the same promise: up to 3 stories (was 2) each with a why-it-fits cue and up to 3 beats lifted from the story's own S/A/R text, the bank's own Result line shown under each story, up to 6 keywords, and cv_leads: up to 3 items quoted from the CV/materials when the bank has no story for the question (rendered as "From your CV"). Live on Haiku 5.5: beats and a CV lead came back valid, with an honest watch_out that the bank had no matching story. 87 tests green.
- 2026-10-24 (session 2, context): analysis showed the CV/JD/bank were already sent on every hint (cached prefix ~2.8k tokens measured for a realistic setup), so no "feed context" button. Built instead: (1) "Interview so far" digest from the question queue in the user turn, zero extra calls; (2) "More for the coach" materials (cover letter, LinkedIn, company research, notes; upload or paste) in the cached prefix; (3) 1h cache TTL so hints minutes apart stay cached; (4) "What the coach sees" panel with per-component estimates, cache-minimum warning and an exact count via count_tokens; (5) context tiers Lean/Standard/Everything; (6) live hints default to Haiku 5.5, prep/debrief pinned to Opus 5.5 (PREP_MODEL). 84 tests green.
- 2026-10-24 (session 2): CV upload added (PDF, DOCX, ODT, TXT, MD; .doc/Google Docs get a download-as-.docx instruction; real LibreOffice .odt and .docx both round-trip exactly). Settings sections now carry descriptions; README has a CV formats table. Design: every format becomes compact plain text in the textarea (no JSON: ~30% token overhead for no information gain; the structured artefact is the story bank). lib/cvText.js normalises (whitespace, bullet glyphs, repeated page furniture, 14k-char cap), lib/zip.js + docxXmlToText parse DOCX locally with the native DecompressionStream (no library), PDF goes through one Haiku call (claude.cvTextFromPdf). Verified: PDF live (1 page = ~2k input tokens, faithful), real LibreOffice-generated .docx round-trips exactly. 72 tests green.
- 2026-10-24 (session 2, after a real call): hints fired but read as generic because the story bank was empty, and one fragmented question produced five near-duplicate queue entries. Fixed: questions supersede while the interviewer is still asking (lib/questionQueue.js, 7 tests); dismissed questions sink to the bottom and every row has its own dismiss/restore control; permanent banner when the bank is empty. Missing stories are now communicated per question (warning on the hint card, a marker in the queue, a count at Stop, and a gap list appended to the saved transcript). New opt-in "Answer shape & likely follow-ups" section: answer_shape + follow_ups in HINT_SCHEMA, validated so they name what to cover and are never sayable as an answer (no first person, no sentences). Verified against the live API with the real call transcript: all 5 shape prompts and 3 follow-ups passed the validator. 62 tests green.
- 2026-10-24 (session 2): added AssemblyAI as an alternative/backup STT provider (stt-assemblyai.js, Universal-Streaming v3). Settings has a provider dropdown + AssemblyAI key field + Test AssemblyAI key button. Browser flow verified end to end with a real key via node: GET /v3/token?expires_in_seconds -> wss://streaming.assemblyai.com/v3/ws?token=... -> Begin received. Audio reuses the existing pcm-worklet (16-bit PCM). Only the selected provider is used for captions. Added host_permission https://streaming.assemblyai.com/*. 50 tests green. Still TODO: real-call head-to-head Deepgram vs AssemblyAI (latency/accents/cost).
- 2026-10-24 (session 2, ROOT CAUSE FOUND): no hints = every hint call returned HTTP 400 "output_config.format.schema: For 'array' type, property 'maxItems' is not supported". HINT_SCHEMA used maxItems on stories/keywords and GAP_SCHEMA used minItems/maxItems; the structured-output validator forbids them. Removed them (limits are still enforced in validateHint / gapReport post-filter). Verified by curl with the real buildHintRequest body: HTTP 200, valid hint JSON, cache_read_input_tokens=1218 (prompt caching confirmed live). The Anthropic key is fine. This bug also broke the gap report (same schema class).
- 2026-10-24 (session 2): audio/captions confirmed working in a real call. No AI hints appeared — most likely the Anthropic key is missing/invalid (separate from Deepgram), and the error only flashed in the status line. Fixes shipped: hint errors + "Analysing…" now show on the hint card itself; added "Test Anthropic key" button in Settings. ACTION: user to click Test Anthropic key and report. Also redesigned the coach UI: detected questions now form a clickable queue with triage chips (Answer this / Think about it / No action) and quick revisit; added "Save transcript" to download the full conversation as .txt. Backlog S1 (AssemblyAI provider) still open.
- 2026-10-24: keys pasted into Settings appeared not to save → fixed (autosave + validate + sticky Save). Chromium crashed when scaling the window → layout shrink limits and debounced autosave added; not reproduced since. "Deepgram connection failed" was an AssemblyAI key being used by mistake → added Test Deepgram key button and clearer errors. Deepgram key now verified working from curl. Backlog: S1 AssemblyAI provider (PLAN.md).
- (paste console errors / observations here; the agent reads this first every tick)

## Tick log
- 2026-10-21 03:10 tick 15: idle (no feedback). claude.js: 8 s timeout on hints, 180 s on prep calls, clear error when key missing. background.js: coach window id in storage.session so no duplicate windows after worker suspension.
- 2026-10-21 02:50 tick 14: idle (no feedback). stt.js: open AudioContext first and send its real sample rate to Deepgram (fallback if 16 kHz refused); resume suspended context. Docs: wear headphones.
- 2026-10-21 02:30 tick 13: idle (no feedback). Static review of manifest.json: removed invalid `wss://` host_permission that would have blocked the extension from loading; test added.
- 2026-10-21 02:10 tick 12: idle (no feedback). Static review of options.js: Claude-generated stories/gaps/imports now auto-save instead of waiting for the Save button.
- 2026-10-21 01:50 tick 11: idle (no feedback). Static review of panel.js found a bug: transcript persisted across sessions in one window → fixed with beginSessionIfNeeded(); hint card resets per session.
- 2026-10-21 01:30 tick 10: M6.2 done. Only M6.1 (human smoke test) remains. No human feedback yet.
- 2026-10-21 01:10 tick 9: M5.1, M5.2 done; milestones M0–M5 complete. 41 tests green. Waiting on M6.1 (human smoke test).
- 2026-10-21 00:50 tick 8: M4.2, M4.3 done; milestone M4 complete. 38 tests green. No human feedback yet. (Two loop prompts fired together; handled as one tick.)
- 2026-10-21 00:30 tick 7: M3.4, M3.5, M4.1 done; milestone M3 complete. 33 tests green. No human feedback yet.
- 2026-10-21 00:10 tick 6: M3.2, M3.3 done. 29 tests green. No human feedback yet.
- 2026-10-20 23:50 tick 5: M3.1 done. 22 tests green. No human feedback yet.
- 2026-10-20 23:30 tick 4: M2.2, M2.3, M2.4 done; milestone M2 complete. No human feedback yet.
- 2026-10-20 23:10 tick 3: M1.4, M2.1 done, milestone M1 complete. 18 tests green. No human feedback yet.
- 2026-10-20 22:50 tick 2: M1.2, M1.3 done. No human feedback yet.
- 2026-10-20 22:30 tick 1: M0.1, M0.2, M1.1 done. Loop job f73f8d27 every 20m.
- 2026-10-20 scaffold written, plan created.
