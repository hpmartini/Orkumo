#!/usr/bin/env bash
# Review for #182 (preview browser controls). Run from the PR worktree root.
#   scripts/review/182.sh          tests + real-Electron smoke test
#   scripts/review/182.sh --live   then also starts the desktop app (bun run electron:dev) for the visual check
set -euo pipefail
cd "$(dirname "$0")/../.."

LOG="$(mktemp -t devorbit-182-smoke)"
SMOKE_PID=""
LIVE_PID=""
cleanup() {
  if [[ -n "$SMOKE_PID" ]]; then
    pkill -9 -P "$SMOKE_PID" 2>/dev/null || true
    kill -9 "$SMOKE_PID" 2>/dev/null || true
  fi
  if [[ -n "$LIVE_PID" ]]; then
    pkill -TERM -P "$LIVE_PID" 2>/dev/null || true
    kill -TERM "$LIVE_PID" 2>/dev/null || true
  fi
  rm -f "$LOG"
}
trap cleanup EXIT INT TERM

[[ -d node_modules ]] || bun install --frozen-lockfile

echo "== unit + component tests"
bunx vitest run test/browserViewNav.test.js test/electronBrowserView.test.tsx

echo "== real Electron smoke test (BrowserView, native input)"
unset ELECTRON_RUN_AS_NODE
node_modules/.bin/electron scripts/review/182-smoke.mjs >"$LOG" 2>&1 &
SMOKE_PID=$!
for _ in $(seq 1 120); do
  grep -qE "checks passed|check\(s\) failed" "$LOG" && break
  sleep 0.5
done
if ! grep -E "^(PASS|FAIL)|checks passed|check\(s\) failed" "$LOG"; then
  cat "$LOG"
  echo "smoke test produced no result"
  exit 1
fi
grep -q "all checks passed" "$LOG"

if [[ "${1:-}" == "--live" ]]; then
  echo "== starting desktop app (quit the installed DevOrbit first: same single-instance lock)"
  bun run electron:dev &
  LIVE_PID=$!
  cat <<'TXT'
Visual check in the app window (Code mode -> browser preview):
  1. Back/forward arrows left of refresh, greyed out until you follow a link
  2. Close button top right next to "DevTools" is an X
  3. Mouse side buttons (and Cmd+[ / Cmd+]) go back/forward in the preview
  4. Click into the preview, Cmd+R / F5: only the preview reloads, terminals keep their content
  5. Click into a terminal, Cmd+R: the whole app reloads (unchanged)
Ctrl+C stops the app.
TXT
  wait "$LIVE_PID"
fi
