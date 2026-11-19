#!/usr/bin/env bash
# Name check (piece 10b, Hashim, Nov 19, 2026). Runs in CI (Checks, job "name-check") on every push.
#
# Fails when this branch adds client data to the repository. It scans the files the branch changes (whole files, so the lines
# added against main are covered) and the commit messages since main for:
#   (a) a 9-digit number, plain or written 3-3-3 with spaces or dashes, that passes CRA's business number check digit (the
#       Luhn check). A number touching a letter before it (wb123..., a hash) is not a business number; "RC0001" after it is.
#   (b) a client name from the CLIENT_NAMES secret (one name per line, kept outside the repository). When it is not set, (b) is
#       skipped with a warning and (a) still runs.
# A hit names the file and line (or the commit), never the value found. Lines removed are not scanned.
# On main itself (nothing to compare) the whole repository is scanned. Binary files are listed by name for a person to check.
#
# The secret: passed only through the environment, read by the script below and never printed. No "set -x".
set -euo pipefail
set +x
cd "$(dirname "$0")/../.."
BASE="${BASE_REF:-origin/main}"
NAMES_FILE=""
cleanup() { if [[ -n "$NAMES_FILE" ]]; then rm -f "$NAMES_FILE"; fi; }
trap cleanup EXIT
if [[ -n "${CLIENT_NAMES:-}" ]]; then
  NAMES_FILE="$(umask 077; mktemp)"
  printf '%s\n' "$CLIENT_NAMES" > "$NAMES_FILE"
fi
unset CLIENT_NAMES

if git rev-parse --verify -q "$BASE" >/dev/null && [[ "$(git rev-parse HEAD)" != "$(git rev-parse "$BASE")" ]]; then
  MODE=branch
  git diff --name-only -z --diff-filter=ACMR "$BASE"...HEAD > "${TMPDIR:-/tmp}/name-check-files.$$"
  git log --format='%h%x00%B%x1e' "$BASE"..HEAD > "${TMPDIR:-/tmp}/name-check-msgs.$$"
else
  MODE=tree
  git ls-files -z > "${TMPDIR:-/tmp}/name-check-files.$$"
  : > "${TMPDIR:-/tmp}/name-check-msgs.$$"
fi
FILES="${TMPDIR:-/tmp}/name-check-files.$$"; MSGS="${TMPDIR:-/tmp}/name-check-msgs.$$"
trap 'cleanup; rm -f "$FILES" "$MSGS"' EXIT

python3 -I - "$MODE" "$FILES" "$MSGS" "$NAMES_FILE" <<'PY'
import os, re, sys
mode, files_path, msgs_path, names_path = sys.argv[1:5]
NUM = re.compile(r'(?<![0-9A-Za-z_])(\d{9}|\d{3}[ -]\d{3}[ -]\d{3})(?!\d)')
def bn_like(raw):
    d = re.sub(r'\D', '', raw)
    total = 0
    for i, c in enumerate(reversed(d)):
        n = int(c)
        if i % 2 == 1:
            n *= 2
            if n > 9: n -= 9
        total += n
    return total % 10 == 0
names = []
if names_path:
    for n in open(names_path, encoding='utf-8', errors='replace').read().replace('\r', '').split('\n'):
        n = ' '.join(n.split())
        if len(n) >= 3: names.append(re.compile(r'(?<!\w)' + re.escape(n).replace(r'\ ', r'\s+') + r'(?!\w)', re.I))
hits = []
def scan(text, where):
    for no, line in enumerate(text.split('\n'), 1):
        if any(bn_like(m.group(1)) for m in NUM.finditer(line)):
            hits.append(f'{where(no)}: a 9-digit number that passes the business number check digit')
        if any(p.search(line) for p in names):
            hits.append(f'{where(no)}: a client name')
binaries = []
for f in [x for x in open(files_path, 'rb').read().decode('utf-8', 'replace').split('\0') if x]:
    try:
        raw = open(f, 'rb').read()
    except (FileNotFoundError, IsADirectoryError):
        continue
    if b'\0' in raw[:8192]:
        binaries.append(f); continue
    scan(raw.decode('utf-8', 'replace'), lambda no, f=f: f'{f}:{no}')
for rec in open(msgs_path, encoding='utf-8', errors='replace').read().split('\x1e'):
    rec = rec.strip('\n')
    if not rec: continue
    sha, _, body = rec.partition('\0')
    scan(body, lambda no, sha=sha: f'commit {sha}, message line {no}')
print(f'Name check ({"files changed against main and commit messages" if mode == "branch" else "whole repository"}).')
if not names_path:
    print('WARNING: CLIENT_NAMES is not set: client names were not checked. Business numbers were.')
for b in binaries:
    print(f'Not scanned (binary), check by hand: {b}')
for h in hits:
    print(f'::error::{h} (value hidden)' if "GITHUB_ACTIONS" in os.environ else f'FOUND {h} (value hidden)')
if hits:
    print(f'{len(hits)} hit(s). Replace each value with made-up data (a number that fails the check digit, a dummy name), then push again.')
    sys.exit(1)
print('No business number or client name found.')
PY
