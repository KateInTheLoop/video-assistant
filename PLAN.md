# Interview Coach — MVP implementation plan (agent-driven)

Target: **Linux + Chrome, MVP usable in a real interview.** Windows (system audio) comes after MVP.

## How the agent works this plan (one tick = one 20-minute pass)

1. Read `STATE.md`. Pick the first node whose status is `todo` and whose `deps` are all `done`.
   If a node is `blocked`, skip it and note why in STATE.md.
2. Implement only that node. Keep changes small enough to finish in one tick; if not, split it into sub-nodes in STATE.md and finish the first.
3. Verify with the node's **Done when** check. Run `node --check` on every changed JS file and `npm test` if tests exist.
4. Update STATE.md (status, one-line note, blockers), `git add -A && git commit`.
5. Stop. Do not start a second node in the same tick unless the first took under 5 minutes.

Rules: never generate full answers in hints (keywords, own stories only). Never upload transcripts anywhere. Vanilla JS, no bundler. Ask the user only via STATE.md "Needs human" section; keep going on other nodes meanwhile.

## Node graph

```
M0 Tooling ──► M1 Pure-logic tests ──► M2 Robust capture ──► M3 Hint quality ──► M4 Prep flow ──► M5 Debrief ──► MVP
                                   └──► M6 Smoke test in real Chrome (parallel, needs human to load extension)
```

### M0 — Tooling (deps: none)
- M0.1 `git init`, `.gitignore`, first commit of current scaffold. Done when: `git log` shows a commit.
- M0.2 `package.json` with `"test": "node --test tests/"`; no dependencies. Done when: `npm test` runs (0 tests OK).
- M0.3 Check for Chrome/Chromium on this Linux box; if absent write install instructions into STATE.md "Needs human". Done when: STATE.md records result.

### M1 — Pure-logic extraction + tests (deps: M0)
Goal: move testable logic out of panel.js so the agent can verify without a browser.
- M1.1 `lib/transcript.js`: `mergeFinal(transcript, line, now)` (same-speaker merge within 4 s), `recent(transcript, n)`. Tests.
- M1.2 `lib/question.js`: `shouldAskForHint(text, speechFinal, pendingWords)` → `{ask: bool, delayMs}`. Rules: `?` → ask now; `speechFinal` → ask now; <3 words → never; else delay 900 ms. Tests cover "mm-hm", "okay so", multi-sentence.
- M1.3 `lib/hintSchema.js`: export HINT_SCHEMA + `validateHint(obj)` (shape, ≤4 keywords, each ≤3 words, ≤2 stories, story titles ∈ bank). Tests. Panel must drop any hint that fails validation.
- M1.4 Rewire `panel.js` and `claude.js` to import from `lib/`. Done when: `node --check` passes, `npm test` green.

### M2 — Robust capture (deps: M1)
- M2.1 Reconnect: if Deepgram socket closes with non-1000 code, retry with backoff (1 s, 2 s, 4 s, max 3) while the media stream is live; show status. Done when: logic lives in `stt.js` with a unit-testable `backoffDelays()`.
- M2.2 Mic permission fallback: if `getUserMedia` throws `NotAllowedError` in the popup window, show a link that opens `options.html` where the user grants mic once. Done when: options.html has a "Test microphone" button that requests the mic.
- M2.3 Web Speech API fallback for the **mic only** when no Deepgram key is set (`webkitSpeechRecognition`, continuous, interim). Interviewer stream still requires Deepgram; status text explains. Done when: panel works with only an Anthropic key for mic captions.
- M2.4 Linux note: `getDisplayMedia` system audio is unavailable; UI copy must say "pick the meeting tab and tick Share tab audio". Verify copy present. (Windows system-audio is a post-MVP node W1.)

### M3 — Hint quality and latency (deps: M1)
- M3.1 Measure: log hint latency and token usage (`usage.cache_read_input_tokens`) to console and a ring buffer shown in Settings → Diagnostics. Done when: cache reads are non-zero on the second call in a session (verify by reading the log the user pastes, or by a mocked test of the request body: stable system prefix, volatile transcript in user message).
- M3.2 Debounce: never fire two hint calls <2 s apart; coalesce interviewer fragments. Tests on the pure scheduler.
- M3.3 Follow-up awareness: include the last hint in the request so a follow-up ("and what did you learn?") is labelled `follow_up: true` and keeps the same story. Extend schema + validator + tests.
- M3.4 Keyword guard in prompt + validator: reject any keyword >3 words or ending in punctuation. Tests.
- M3.5 Model switch in Settings: dropdown `claude-opus-5-5` (default) / `claude-haiku-5-5` (fastest). Done when: stored and used.

### M4 — Prep flow (deps: M3)
- M4.1 Guided story interview in Settings: Claude asks 10 standard behavioral questions one at a time (text), candidate types/pastes answers, each becomes a story. Structured output. Done when: stories appear in bank with `source: "interview"`.
- M4.2 Gap report: given JD + bank, list likely questions with no matching story. Done when: shown under "Likely questions" with a ⚠ marker.
- M4.3 Import/export story bank as JSON. Done when: round-trip test on `lib/bank.js`.

### M5 — Debrief (deps: M2, M3)
- M5.1 After Stop, one Claude call over the saved transcript: for each question → which story was used, STAR parts hit/missed, one concrete improvement. Structured output; stored with the session. Done when: Settings → Past sessions shows the debrief.
- M5.2 Pacing stats per answer (seconds talked) computed locally in `lib/pace.js`. Tests.

### M6 — Real-Chrome smoke test (deps: M0; **needs human**)
- M6.1 Human loads unpacked extension, runs a Meet test call, pastes console errors into STATE.md "Human feedback". Agent fixes what's reported. Repeat until the hint card renders in a live call.
- M6.2 Write `docs/first-run.md` with screenshots placeholders and the exact click sequence.

### MVP exit criteria
- [ ] All M0–M5 nodes done, `npm test` green.
- [ ] M6.1 confirmed by human in a real Meet call on Linux.
- [ ] Hint latency < 2.5 s median (from M3.1 log) on Opus, < 1.5 s on Haiku.
- [ ] No transcript leaves the machine except the recent lines sent to Claude.

## Post-MVP (do not start before exit criteria)
- W1 Windows: system audio via `getDisplayMedia` screen share with audio (works on Windows/ChromeOS), fallback to tab audio. Test on Windows.
- P1 Practice mode: Claude plays interviewer with browser TTS, same pipeline, debrief at the end.
- F1 Firefox port: popup window instead of side panel already; replace `chrome.*` with `browser.*` shim.
- S1 AssemblyAI as a second STT provider (added 2026-10-24). `stt-assemblyai.js` with the same `SttStream` interface (Universal-Streaming WebSocket, short-lived token fetched with the API key; verify CORS on the token endpoint from an extension page). Settings: provider dropdown + AssemblyAI key field; `lib/settings.js` validates per provider (AssemblyAI keys are 32 hex, Deepgram 40). Then compare the two in a real call: latency, accent robustness, cost per hour. Keep whichever wins as default.
