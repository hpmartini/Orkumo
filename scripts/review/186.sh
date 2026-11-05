#!/usr/bin/env bash
# Review for #186 (logins in the built-in browser survive a restart). Run from the PR worktree root.
#   scripts/review/186.sh          unit tests + real-Electron restart check (with negative control)
#   scripts/review/186.sh --live   then also starts the desktop app for the claude.ai check
set -euo pipefail
cd "$(dirname "$0")/../.."

WORK="$(mktemp -d -t orkumo-186)"
LIVE_PID=""
cleanup() {
  if [[ -n "$LIVE_PID" ]]; then
    pkill -TERM -P "$LIVE_PID" 2>/dev/null || true
    kill -TERM "$LIVE_PID" 2>/dev/null || true
  fi
  rm -rf "${WORK:?}"
}
trap cleanup EXIT INT TERM

[[ -d node_modules ]] || bun install --frozen-lockfile
unset ELECTRON_RUN_AS_NODE

echo "== unit tests"
bunx vitest run test/cookiePersistence.test.js

# electron <phase> <fix>: one app run; it prints DONE once the cookie store is written, then gets ended
# (headless Electron hangs on quit here). Output lands in $WORK/<phase>-<fix>.log
electron() {
  local log="$WORK/$1-$2.log" n=0
  PHASE="$1" FIX="$2" USER_DATA="$WORK/userdata-$2" node_modules/.bin/electron scripts/review/186-restart.mjs >"$log" 2>&1 &
  local pid=$!
  until grep -q '^DONE' "$log" || (( n++ >= 60 )); do sleep 0.5; done
  pkill -TERM -P "$pid" 2>/dev/null || true
  kill -TERM "$pid" 2>/dev/null || true
  wait "$pid" 2>/dev/null || true
  grep -q '^DONE' "$log" || { cat "$log"; echo "electron $1/$2: no DONE within 30 s"; return 1; }
  grep '^AFTER' "$log"
}
# run <fix on|off>: set cookies, close/reopen pane, quit; start again on the same userData, list survivors
run() {
  mkdir -p "$WORK/userdata-$1"
  electron set "$1"
  electron check "$1"
}

echo "== real Electron restart, without fix (negative control)"
OFF="$(run off)" || { echo "$OFF"; exit 1; }; echo "$OFF"
echo "== real Electron restart, with fix"
ON="$(run on)" || { echo "$ON"; exit 1; }; echo "$ON"

fail=0
check() { if eval "$2"; then echo "PASS $1"; else echo "FAIL $1"; fail=1; fi; }
check "control: Electron drops the session cookie on restart" '[[ "$OFF" == *"AFTER_RESTART pref(session=false)"* ]]'
check "AC-2 login cookie survives closing and reopening the pane" '[[ "$ON" == *"AFTER_PANE_REOPEN login(session="* ]]'
check "AC-3 login cookie survives quit and restart" '[[ "$ON" == *"AFTER_RESTART login(session=false) pref(session=false)"* ]]'
check "AC-4 persistent cookie unchanged" '[[ "$ON" == *"pref(session=false)"* && "$OFF" == *"pref(session=false)"* ]]'
[[ $fail == 0 ]] || exit 1
echo "all checks passed"

if [[ "${1:-}" == "--live" ]]; then
  echo "== starting desktop app (quit the installed Orkumo first: same single-instance lock)"
  bun run electron:dev &
  LIVE_PID=$!
  cat <<'TXT'
Check in the app window:
  1. Open https://claude.ai in the built-in browser, log in
  2. Close the browser pane, open it again: still logged in
  3. Quit the app (Cmd+Q), run this script with --live again, open claude.ai: still logged in
Ctrl+C stops the app.
TXT
  wait "$LIVE_PID"
fi
