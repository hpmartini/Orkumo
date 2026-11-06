#!/usr/bin/env bash
# Review #198: rail text search. Unit tests, typecheck, then the real app on spare ports with a
# throwaway data dir (real agent sessions via the claude CLI), an e2e run in Chromium with
# screenshots, and the app left running for a look until Ctrl+C.
set -euo pipefail
cd "$(dirname "$0")/../.."
TMP=$(mktemp -d)
PIDS=()
set -m # each background job gets its own process group, so npx/vite children stop with it
cleanup() { for p in "${PIDS[@]:-}"; do [ -n "$p" ] && kill -TERM -- "-$p" 2>/dev/null || true; done; rm -rf "$TMP"; }
trap cleanup EXIT INT TERM
free_port() { python3 -c 'import socket;s=socket.socket();s.bind(("",0));print(s.getsockname()[1]);s.close()'; }

[ -d node_modules ] || bun install
npx vitest run
npx tsc --noEmit

SERVER_PORT=$(free_port); VITE_PORT=$(free_port)
mkdir -p "$TMP/data"
SERVER_PORT=$SERVER_PORT DEVORBIT_DATA_PATH="$TMP/data" node server/index.js >"$TMP/server.log" 2>&1 & PIDS+=($!)
SERVER_PORT=$SERVER_PORT VITE_PORT=$VITE_PORT npx vite >"$TMP/vite.log" 2>&1 & PIDS+=($!)
URL="http://localhost:$VITE_PORT"
for _ in $(seq 1 60); do curl -sf "$URL" >/dev/null && curl -sf "http://localhost:$SERVER_PORT/api/agents" >/dev/null && break; sleep 1; done

(cd "$TMP" && echo '{"private":true}' >package.json && bun add playwright >/dev/null && node node_modules/playwright/cli.js install chromium >/dev/null)
mkdir -p "$TMP/shots"
NODE_PATH="$TMP/node_modules" node scripts/review/198-e2e.cjs "$URL" "$TMP/shots"
cp -r "$TMP/shots" ./review-198-shots
echo "Screenshots: $PWD/review-198-shots"
echo "App: $URL/agents (kein Login, eigene Daten). Feld 'Suche' in der Filterzeile; Ctrl+C stoppt."
wait
