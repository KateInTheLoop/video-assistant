# Interview Coach — agent rules

## Credentials: hard check before every push (non-negotiable)

Before **any** `git push` — new branch, update, or force-push — the secret scan must pass:

```
python3 -I scripts/check_secrets.py      # or: npm run scan
```

If it reports anything, **do not push.** Fix it first:
- Replace the value with a synthetic fixture (sequential/low-diversity hex, or a name with
  `example`/`test`/`fake` in it). Real-looking random strings fail the scan by design.
- If a value is provably fake but the scanner still flags it, add it to `ALLOWLIST` in
  `scripts/check_secrets.py` **on purpose**, in the same commit.
- Only as a last resort, mark the exact line `secret-scan: ignore` with a written reason.

Further rules, learned the hard way (a real AssemblyAI key once reached a public commit):
- **Never** paste a real API key, token, password, or personal email into source, tests,
  fixtures, commit messages, or docs. Test fixtures use synthetic values only.
- Keys the user shares in chat are for live `curl`/node checks **in the shell only**. They
  never get written to a tracked file.
- If a real credential has already been committed, treat it as compromised: tell the user to
  revoke/rotate it first (only they can), then scrub it from the working tree and, if they
  agree, from history, and force-push.
- The scan also runs as a git `pre-push` hook (`scripts/pre-push`) and in CI, but the agent
  runs it explicitly before pushing rather than relying on the hook being installed.

## Tests

`npm test` (`node --test tests/`). Keep it green before every commit. Pure logic lives in
`lib/` with a matching `tests/*.test.js`; browser glue (`panel.js`, `options.js`, `*.js` at
root) is not unit-tested.

## Attribution

Commit as the user's git identity. Append the `Co-Authored-By` trailer the session specifies.
