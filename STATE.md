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
| M2.3 | todo | |
| M2.4 | todo | |
| M3.1 | todo | |
| M3.2 | todo | |
| M3.3 | todo | |
| M3.4 | todo | |
| M3.5 | todo | |
| M4.1 | todo | |
| M4.2 | todo | |
| M4.3 | todo | |
| M5.1 | todo | |
| M5.2 | todo | |
| M6.1 | blocked | needs human: load extension in Chrome, run a Meet test call |
| M6.2 | todo | |

## Needs human
- (none yet)

## Human feedback
- (paste console errors / observations here; the agent reads this first every tick)

## Tick log
- 2026-10-20 23:30 tick 4: M2.2 done. No human feedback yet.
- 2026-10-20 23:10 tick 3: M1.4, M2.1 done, milestone M1 complete. 18 tests green. No human feedback yet.
- 2026-10-20 22:50 tick 2: M1.2, M1.3 done. No human feedback yet.
- 2026-10-20 22:30 tick 1: M0.1, M0.2, M1.1 done. Loop job f73f8d27 every 20m.
- 2026-10-20 scaffold written, plan created.
