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
- (paste console errors / observations here; the agent reads this first every tick)

## Tick log
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
