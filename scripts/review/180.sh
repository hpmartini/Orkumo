#!/usr/bin/env bash
# Review #180: iOS app moved to DevHub-pro. Checks this DevHub branch (build, lint, tests, no Capacitor
# left), the remote-access token gate on a throwaway server, and builds the Pro app from a fresh clone
# against this checkout up to xcodebuild for the simulator. Then serves the UI for a look;
# Ctrl+C stops server and Vite and deletes the clone and the throwaway data dir.
#   PRO_BRANCH (default main), SIM (default "iPhone 16"), REVIEW_SERVER_PORT (3297), REVIEW_VITE_PORT (3298)
set -euo pipefail
cd "$(dirname "$0")/../.."
ROOT=$PWD

PRO_BRANCH="${PRO_BRANCH:-main}"
SIM="${SIM:-iPhone 16}"
PORT="${REVIEW_SERVER_PORT:-3297}"
VITE_PORT="${REVIEW_VITE_PORT:-3298}"
TMP=$(mktemp -d)
pids=()
# bunx forks vite as a child: stop children first, then the launcher
cleanup() {
  for p in ${pids[@]+"${pids[@]}"}; do pkill -P "$p" 2>/dev/null || true; kill "$p" 2>/dev/null || true; done
  rm -rf "$TMP"
}
trap cleanup EXIT
trap 'exit 130' INT TERM # aborted before the checks finished

step() { printf '\n== %s\n' "$*"; }

[ -d node_modules ] || bun install

step "AC-1 build, lint, tests"
fail() { echo "FAIL $*"; exit 1; }
bun run build >"$TMP/build.log" 2>&1 || fail "build, see $TMP/build.log"
echo "build ok"
bun run lint >"$TMP/lint.log" 2>&1 || fail "lint"
echo "lint ok"
bunx vitest run 2>&1 | grep -E "Test Files|Tests "

CAP='@capa''citor' # split so this script is not a match of its own (and of the AC-2 grep)
step "AC-2 no iOS project, no $CAP"
[ -z "$(git ls-files ios capacitor.config.json)" ] || fail "ios/ or capacitor.config.json tracked"
echo "ios/, capacitor.config.json: not tracked"
# TASK.md (from main) only logs an old tsc message naming the package: no dependency, no import
if git grep -n "$CAP" -- ':!docs' ':!briefings' ':!TASK.md'; then fail "$CAP found"; fi
echo "$CAP: no match"

step "AC-3 token gate (throwaway server :$PORT, data in $TMP/data)"
L="http://127.0.0.1:$PORT"
! curl -s -o /dev/null "$L/" || fail "port $PORT busy, set REVIEW_SERVER_PORT"
DEVORBIT_DATA_PATH="$TMP/data" SERVER_PORT=$PORT DEVORBIT_REMOTE=true node server/index.js >"$TMP/server.log" 2>&1 &
pids+=($!)
L="http://127.0.0.1:$PORT"
for _ in $(seq 1 30); do curl -sf -o /dev/null "$L/api/health" && break; sleep 1; done
TOKEN=$(curl -sf "$L/api/remote/pairing" | python3 -c "import sys,json;print(json.load(sys.stdin)['token'])")
code() { curl -s -o /dev/null -w '%{http_code}' "$@"; }
FWD=(-H "X-Forwarded-For: 100.64.0.2") # what tailscale serve adds: a remote client behind loopback
expect() { [ "$2" = "$3" ] || fail "$1: $2 (want $3)"; echo "ok   $1: $2"; }
expect "local, no token" "$(code "$L/api/health")" 200
expect "remote, no token" "$(code "${FWD[@]}" "$L/api/health")" 401
expect "remote, wrong token" "$(code "${FWD[@]}" -H 'X-DevOrbit-Token: nope' "$L/api/health")" 401
expect "remote, valid token" "$(code "${FWD[@]}" -H "X-DevOrbit-Token: $TOKEN" "$L/api/health")" 200
expect "remote, token in query" "$(code "${FWD[@]}" "$L/api/health?token=$TOKEN")" 200
expect "remote, pairing endpoint" "$(code "${FWD[@]}" -H "X-DevOrbit-Token: $TOKEN" "$L/api/remote/pairing")" 403
curl -s -D - -o /dev/null "${FWD[@]}" -H 'Origin: capacitor://localhost' -H "X-DevOrbit-Token: $TOKEN" "$L/api/health" |
  grep -qi '^access-control-allow-origin: capacitor://localhost' || fail "CORS capacitor://localhost"
echo "ok   CORS capacitor://localhost"

step "AC-4 DevHub-pro $PRO_BRANCH from a fresh clone, built against this checkout"
gh repo clone hpmartini/DevHub-pro "$TMP/pro" -- -q --depth 1 -b "$PRO_BRANCH"
(cd "$TMP/pro/apps/ios" && bun install --frozen-lockfile >/dev/null && DEVHUB_DIR="$ROOT" bun run sim "$SIM" "$TMP/dd")

# DEVORBIT_REMOTE keeps Vite on 127.0.0.1: its proxy looks like loopback to the token gate
DEVORBIT_REMOTE=true VITE_PORT=$VITE_PORT SERVER_PORT=$PORT bunx vite --port "$VITE_PORT" >"$TMP/vite.log" 2>&1 &
pids+=($!)
for _ in $(seq 1 30); do curl -sf -o /dev/null "http://localhost:$VITE_PORT/" && break; sleep 1; done

cat <<MSG

Sichtprüfung: http://localhost:$VITE_PORT/   (kein Login; API auf :$PORT, Remote-Zugang an)
  - Admin Panel → "iOS-App": Adresse, Token, devorbit://pair-Link, QR-Code
Simulator-E2E (braucht tailscale serve vor :$PORT und eine laufende Agent-Session, siehe apps/ios/README.md in DevHub-pro):
  cd <DevHub-pro-Checkout>/apps/ios && bun run sync && scripts/ios-e2e.sh "$SIM" https://<mac>.<tailnet>.ts.net:8443 http://127.0.0.1:$PORT /tmp/ios-e2e <agent-id>
Beenden: Ctrl+C
MSG
trap 'exit 0' INT TERM # Ctrl+C here is the normal end of the review
wait
