#!/usr/bin/env bash
# Review #126 (auto-update): unit tests, workflow lint, e2e with real packaged fixture apps against a fake GitHub.
# Run from the repo root of a checkout of feat/126-auto-update. Needs bun; macOS for e2e-mac, Docker for e2e-linux.
# Builds land in a temp dir that is removed on exit (KEEP=1 keeps it and prints the path).
set -euo pipefail
unset ELECTRON_RUN_AS_NODE
cd "$(dirname "$0")/../.."
work=$(mktemp -d)
cleanup() {
  pkill -f "fake-github.mjs" 2>/dev/null || true
  if [ -n "${KEEP:-}" ]; then echo "logs and builds kept in $work"; else rm -rf "$work"; fi
}
trap cleanup EXIT

bun install --frozen-lockfile >/dev/null
echo "== unit tests"
bunx vitest run test/updater.test.js test/releaseScripts.test.js
echo "== typecheck"
bunx tsc --noEmit
echo "== actionlint"
if command -v actionlint >/dev/null; then actionlint .github/workflows/release.yml && echo ok; else echo "skipped (brew install actionlint)"; fi

status=0
if [ "$(uname)" = Darwin ]; then
  echo "== Developer-ID detection on installed apps (install vs notify mode on macOS)"
  for a in /Applications/*.app; do
    printf '%s\n' "$a"
  done | head -5 | node --input-type=module -e "
    import { isDeveloperIdSigned } from './electron/updater.js';
    import fs from 'node:fs';
    for (const a of fs.readFileSync(0, 'utf8').trim().split('\n')) console.log(isDeveloperIdSigned(a) ? 'Developer ID' : 'other       ', a);
  "
  echo "== e2e macOS (AC-1, AC-4, AC-5, AC-7)"
  WORK="$work/mac" KEEP=1 scripts/review/126/e2e-mac.sh || status=1
fi
if docker info >/dev/null 2>&1; then
  echo "== e2e Linux AppImage (AC-6)"
  WORK="$work/linux" KEEP=1 scripts/review/126/e2e-linux.sh || status=1
else
  echo "== e2e Linux skipped (Docker not running)"
fi
[ $status = 0 ] && echo "ALL PASS" || echo "SOME FAILED"
echo "Nothing to open in a browser: the evidence is the PASS lines and logs above."
exit $status
