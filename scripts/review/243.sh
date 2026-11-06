#!/usr/bin/env bash
# Review #243: orphaned servers. Unit tests, typecheck, then the real app on spare ports with a
# throwaway data dir, a fake finished worktree (<tmp>/repo/.claude/worktrees/old) with a listening
# dev server and no session, API checks (orphan listed, foreign pid refused), an e2e run in
# Chromium with screenshots + video, and the app left running for a look until Ctrl+C.
set -euo pipefail
cd "$(dirname "$0")/../.."
TMP=$(mktemp -d)
PIDS=()
set -m # each background job gets its own process group, so npx/vite children stop with it
cleanup() {
  for p in "${PIDS[@]:-}"; do [ -n "$p" ] && kill -TERM -- "-$p" 2>/dev/null || true; done
  [ -f "$TMP/orphan.pid" ] && kill -TERM "$(cat "$TMP/orphan.pid")" 2>/dev/null || true
  rm -rf "$TMP"
}
trap cleanup EXIT INT TERM
free_port() { python3 -c 'import socket;s=socket.socket();s.bind(("",0));print(s.getsockname()[1]);s.close()'; }

[ -d node_modules ] || bun install
[ "${SKIP_UNIT:-}" = 1 ] || { npx vitest run; npx tsc --noEmit; }

SERVER_PORT=$(free_port); VITE_PORT=$(free_port); ORPHAN_PORT=$(free_port)
mkdir -p "$TMP/data" "$TMP/repo/.claude/worktrees/old"
# double fork: the fake dev server is re-parented to launchd, like one whose session ended. As a
# child of this script it would (correctly) belong to whatever Claude session runs the script.
(cd "$TMP/repo/.claude/worktrees/old" && { node -e "require('http').createServer((q,r)=>r.end('old')).listen($ORPHAN_PORT)" >/dev/null 2>&1 & echo $! >"$TMP/orphan.pid"; })
ORPHAN_PID=$(cat "$TMP/orphan.pid")
SERVER_PORT=$SERVER_PORT DEVORBIT_DATA_PATH="$TMP/data" node server/index.js >"$TMP/server.log" 2>&1 & PIDS+=($!)
SERVER_PORT=$SERVER_PORT VITE_PORT=$VITE_PORT npx vite >"$TMP/vite.log" 2>&1 & PIDS+=($!)
URL="http://localhost:$VITE_PORT"
API="http://localhost:$SERVER_PORT/api/agents"
for _ in $(seq 1 90); do curl -sf "$URL" >/dev/null && curl -sf "$API/servers/orphans" >/dev/null && break; sleep 1; done

# the context snapshot is stale-while-revalidate (10 s): poll until the fresh scan has the orphan
for _ in $(seq 1 30); do ORPHANS=$(curl -sf "$API/servers/orphans"); echo "$ORPHANS" | grep -q "\"pid\":$ORPHAN_PID" && break; sleep 2; done
if echo "$ORPHANS" | grep -q "\"pid\":$ORPHAN_PID"; then echo "PASS orphan pid $ORPHAN_PID listed"; else echo "FAIL orphan not listed: $ORPHANS"; exit 1; fi
CODE=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$API/servers/$$/stop")
if [ "$CODE" = 404 ]; then echo "PASS foreign pid $$ refused (404)"; else echo "FAIL foreign pid: $CODE"; exit 1; fi
CODE=$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'Origin: https://evil.example' "$API/servers/$ORPHAN_PID/stop")
if [ "$CODE" = 403 ] && kill -0 "$ORPHAN_PID"; then echo "PASS cross-origin stop refused (403), orphan alive"; else echo "FAIL cross-origin: $CODE"; exit 1; fi
CODE=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$API/servers/abc/stop")
if [ "$CODE" = 400 ]; then echo "PASS non-numeric pid refused (400)"; else echo "FAIL abc: $CODE"; exit 1; fi
echo "Orphans on this machine (incl. the fake one):"
echo "$ORPHANS" | node -e 'for (const s of JSON.parse(require("fs").readFileSync(0, "utf8")).servers) console.log(`  :${s.port} pid ${s.pid} ${s.command} ${s.cwd}`)'

(cd "$TMP" && echo '{"private":true}' >package.json && bun add playwright >/dev/null && node node_modules/playwright/cli.js install chromium >/dev/null)
mkdir -p "$TMP/shots"
NODE_PATH="$TMP/node_modules" node scripts/review/243-e2e.cjs "$URL" "$TMP/shots" "$ORPHAN_PID" "$ORPHAN_PORT"
rm -rf ./review-243-shots && cp -r "$TMP/shots" ./review-243-shots
echo "Screenshots + video: $PWD/review-243-shots"
echo "App: $URL/agents (kein Login, eigene Daten). Oben 'servers running' klicken, Abschnitt 'Verwaist'; Ctrl+C stoppt."
[ "${NO_WAIT:-}" = 1 ] || wait
