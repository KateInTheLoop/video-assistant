#!/usr/bin/env python3
"""Hard credential check. Scans tracked (or given) files for real-looking secrets and
personal data, and fails loudly if any are found. Synthetic test fixtures are allowed only
when they are provably fake (placeholder words, sequential/low-diversity strings, or an
explicit allowlist). Run with -I so a planted module in the repo can't hijack imports.

Usage:
    python3 -I scripts/check_secrets.py            # scan all git-tracked files
    python3 -I scripts/check_secrets.py file1 ...  # scan specific files
    python3 -I scripts/check_secrets.py --staged   # scan staged changes only (for hooks)

Exit code 0 = clean, 1 = suspected real secret found, 2 = usage/setup error.
"""
import math
import re
import subprocess
import sys

# --- what a credential looks like -------------------------------------------
# Each rule: (name, compiled regex capturing the secret in group 1 or whole match).
SECRET_RULES = [
    ("Anthropic API key", re.compile(r"sk-ant-(?:api|usr)[A-Za-z0-9_-]{20,}")),
    ("OpenAI API key", re.compile(r"sk-(?:proj-)?[A-Za-z0-9]{32,}")),
    ("AWS access key id", re.compile(r"AKIA[0-9A-Z]{16}")),
    ("Google API key", re.compile(r"AIza[0-9A-Za-z_-]{35}")),
    ("Slack token", re.compile(r"xox[baprs]-[0-9A-Za-z-]{10,}")),
    ("GitHub token", re.compile(r"gh[pousr]_[0-9A-Za-z]{30,}")),
    ("Private key block", re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----")),
    # Generic bearer-looking hex tokens: Deepgram (40 hex) and AssemblyAI (32 hex) both land here.
    ("Hex token (32/40)", re.compile(r"\b[A-Fa-f0-9]{32}\b|\b[A-Fa-f0-9]{40}\b")),
]

# Personal data we never want pushed. Extend as needed.
PERSONAL_RULES = [
    ("Personal email", re.compile(r"[A-Za-z0-9._%+-]+@(?:gmail|outlook|hotmail|yahoo|proton(?:mail)?|icloud)\.[A-Za-z]{2,}")),
]

# Strings that are known-fake fixtures. Add new synthetic test values here on purpose.
ALLOWLIST = {
    "0123456789abcdef0123456789abcdef01234567",
    "0a1b2c3d4e5f60718293a4b5c6d7e8f9",
    "sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123",
}

# Words that mark a value as an obvious placeholder.
PLACEHOLDER_WORDS = re.compile(
    r"(?i)(example|sample|test|fake|placeholder|dummy|redacted|your[-_]?key|changeme|xxxx|todo|notreal|replaceme)"
)

# Files/paths never worth scanning (binary, deps).
SKIP_SUFFIXES = (".png", ".jpg", ".jpeg", ".gif", ".ico", ".pdf", ".zip", ".woff", ".woff2")
SKIP_PARTS = ("node_modules/", ".git/", "dist/")

# Lines carrying this marker are intentionally exempt (use sparingly, with a reason).
INLINE_IGNORE = re.compile(r"secret-scan:\s*ignore", re.I)


def shannon_entropy(s: str) -> float:
    if not s:
        return 0.0
    counts = {c: s.count(c) for c in set(s)}
    n = len(s)
    return -sum((c / n) * math.log2(c / n) for c in counts.values())


def longest_monotonic_run(s: str) -> int:
    """Longest ascending or descending consecutive-codepoint run (abcd, 9876)."""
    best = run_up = run_down = 1
    for a, b in zip(s, s[1:]):
        run_up = run_up + 1 if ord(b) - ord(a) == 1 else 1
        run_down = run_down + 1 if ord(a) - ord(b) == 1 else 1
        best = max(best, run_up, run_down)
    return best


def looks_fake(token: str) -> bool:
    """True when a matched token is provably synthetic, so it can be allowed."""
    if token in ALLOWLIST:
        return True
    if PLACEHOLDER_WORDS.search(token):
        return True
    core = re.sub(r"^(sk-ant-(api|usr)|sk-|AKIA|AIza|gh[pousr]_)", "", token)
    if len(set(core)) <= 4:  # e.g. "aaaaaaaa", "deadbeefdeadbeef"
        return True
    if longest_monotonic_run(core) >= 6:  # abcdefghij…, 0123456789…
        return True
    if shannon_entropy(core) < 2.6:  # very low diversity
        return True
    return False


def tracked_files() -> list[str]:
    out = subprocess.run(["git", "ls-files"], capture_output=True, text=True)
    if out.returncode != 0:
        print("error: not a git repo or git unavailable", file=sys.stderr)
        sys.exit(2)
    return out.stdout.splitlines()


def staged_files() -> list[str]:
    out = subprocess.run(
        ["git", "diff", "--cached", "--name-only", "--diff-filter=ACM"],
        capture_output=True, text=True,
    )
    return [f for f in out.stdout.splitlines() if f]


def scan_file(path: str) -> list[tuple[int, str, str]]:
    findings = []
    try:
        with open(path, "r", encoding="utf-8", errors="ignore") as fh:
            lines = fh.readlines()
    except (OSError, IsADirectoryError):
        return findings
    for lineno, line in enumerate(lines, 1):
        if INLINE_IGNORE.search(line):
            continue
        for label, rule in SECRET_RULES:
            for m in rule.finditer(line):
                token = m.group(0)
                if looks_fake(token):
                    continue
                findings.append((lineno, label, token))
        for label, rule in PERSONAL_RULES:
            for m in rule.finditer(line):
                findings.append((lineno, label, m.group(0)))
    return findings


def redact(token: str) -> str:
    if len(token) <= 8:
        return token[0] + "…"
    return f"{token[:4]}…{token[-4:]}"


def main(argv: list[str]) -> int:
    args = [a for a in argv if not a.startswith("-")]
    if "--staged" in argv:
        files = staged_files()
    elif args:
        files = args
    else:
        files = tracked_files()

    total = 0
    for path in files:
        if path.endswith(SKIP_SUFFIXES) or any(p in path for p in SKIP_PARTS):
            continue
        for lineno, label, token in scan_file(path):
            total += 1
            print(f"  {path}:{lineno}: {label}: {redact(token)}")

    if total:
        print(f"\n✗ {total} suspected real credential(s)/personal value(s) found. "
              f"Do NOT push.\n  Replace with a synthetic fixture, add to ALLOWLIST in "
              f"scripts/check_secrets.py if it is provably fake, or mark the line "
              f"'secret-scan: ignore' with a reason.", file=sys.stderr)
        return 1
    print("✓ secret scan clean")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
