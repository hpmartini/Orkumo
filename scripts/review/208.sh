#!/usr/bin/env bash
# Review #208: issue view order + comment order toggle. Unit tests (AC-1..AC-4), full suite and
# typecheck (AC-5), then the real app on spare ports with a throwaway data dir, opened on #208.
# The board reads MACC with your gh login (read-only: viewing and toggling write nothing to GitHub).
set -euo pipefail
cd "$(dirname "$0")/../.."
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
[ "${SKIP_UNIT:-}" = 1 ] || bunx vitest run
bunx tsc --noEmit

SERVER_PORT=$(free_port); VITE_PORT=$(free_port)
SERVER_PORT=$SERVER_PORT DEVORBIT_DATA_PATH="$TMP" node server/index.js >"$TMP/server.log" 2>&1 & PIDS+=($!)
SERVER_PORT=$SERVER_PORT VITE_PORT=$VITE_PORT bunx vite >"$TMP/vite.log" 2>&1 & PIDS+=($!)
URL="http://localhost:$VITE_PORT"
for _ in $(seq 1 90); do curl -sf "$URL" >/dev/null && break; sleep 1; done
if curl -sf "$URL/api/board/items" | grep -q '"items"'; then echo "PASS board loads via app proxy"; else echo "FAIL board API (gh login?), see $TMP/server.log"; tail -20 "$TMP/server.log"; exit 1; fi

echo "Screenshots: briefings/assets/208/ (panel-oben.png, kommentare-*.png, umschalten.gif)"
echo "App: $URL/board?item=hpmartini%2FOrkumo%23208 (kein Login, eigene Daten)."
echo "Prüfen: Agents/PRs/Sub-Issues unter den Metadaten; ganz unten Beschreibung, Kommentare;"
echo "        'Älteste zuerst' oben rechts bei Kommentare umschalten, Seite neu laden, Wahl bleibt. Ctrl+C stoppt."
[ "${NO_WAIT:-}" = 1 ] || wait
