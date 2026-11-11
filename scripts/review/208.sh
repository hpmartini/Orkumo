#!/usr/bin/env bash
# Review #208: issue view order + comment order toggle.
#   scripts/review/208.sh         unit tests, full suite, typecheck, then the real app (server + vite,
#                                 throwaway data dir, GitHub faked by 208-fake-gh) with a Chromium e2e
#                                 (order, toggle, reload, reply + send, blocked storage), screenshots +
#                                 video, app left running on the fake issue until Ctrl+C
#   scripts/review/208.sh --live  same app against your real MACC board (gh login, read-only) on #208
set -euo pipefail
cd "$(dirname "$0")/../.."
ROOT=$PWD
LIVE=${1:-}
TMP=$(mktemp -d)
PIDS=()
set -m # own process group per job, so vite children stop with it
cleanup() {
  for p in "${PIDS[@]:-}"; do [ -n "$p" ] && kill -TERM -- "-$p" 2>/dev/null || true; done
  rm -rf "$TMP"
}
trap cleanup EXIT INT TERM
free_port() { python3 -c 'import socket;s=socket.socket();s.bind(("",0));print(s.getsockname()[1]);s.close()'; }

[ -d node_modules ] || bun install
bunx vitest run test/IssueView208.test.tsx
[ "${SKIP_UNIT:-}" = 1 ] || { bunx vitest run; bunx tsc --noEmit; }

SERVER_PORT=$(free_port); VITE_PORT=$(free_port)
GH_PATH=$PATH
[ "$LIVE" = "--live" ] || GH_PATH="$ROOT/scripts/review/208-fake-gh:$PATH"
PATH=$GH_PATH FAKE_GH_STATE="$TMP/comments.json" SERVER_PORT=$SERVER_PORT DEVORBIT_DATA_PATH="$TMP" \
  DEVHUB_PREMIUM_DIR=/nonexistent-orkumo-modules node server/index.js >"$TMP/server.log" 2>&1 & PIDS+=($!)
SERVER_PORT=$SERVER_PORT VITE_PORT=$VITE_PORT bunx vite >"$TMP/vite.log" 2>&1 & PIDS+=($!)
URL="http://localhost:$VITE_PORT"
for _ in $(seq 1 90); do curl -sf "$URL" >/dev/null && curl -sf "$URL/api/board/items" >/dev/null && break; sleep 1; done
if curl -sf "$URL/api/board/items" | grep -q '"items"'; then echo "PASS board loads via app proxy"; else echo "FAIL board API, server log:"; tail -20 "$TMP/server.log"; exit 1; fi

if [ "$LIVE" = "--live" ]; then
  echo "App: $URL/board?item=hpmartini%2FOrkumo%23208 (kein Login, eigene Daten, echtes MACC nur lesend). Ctrl+C stoppt."
  wait
  exit 0
fi

(cd "$TMP" && echo '{"private":true}' >package.json && bun add playwright >/dev/null && node node_modules/playwright/cli.js install chromium >/dev/null)
mkdir -p "$TMP/shots"
NODE_PATH="$TMP/node_modules" node scripts/review/208-e2e.cjs "$URL" "$TMP/shots" "$TMP/comments.json"
rm -rf ./review-208-shots && cp -r "$TMP/shots" ./review-208-shots
echo "Screenshots + Video: $PWD/review-208-shots"
echo "App: $URL/board?item=o%2Fonboard%231 (kein Login, Fake-GitHub). Prüfen: Agents/PRs/Sub-Issues oben,"
echo "     'Älteste zuerst' bei Kommentare umschalten, neu laden, Wahl bleibt. Ctrl+C stoppt."
[ "${NO_WAIT:-}" = 1 ] || wait
