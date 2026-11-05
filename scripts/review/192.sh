#!/usr/bin/env bash
# Review #192: agents-rail context menu stays inside the window. Runs the tests, then serves this branch's UI
# on a throwaway Vite port. API: the Orkumo server already running on :3099 (real sessions),
# else a throwaway server from this checkout. Ctrl+C stops everything it started.
set -euo pipefail
cd "$(dirname "$0")/../.."

VITE_PORT="${VITE_PORT:-3192}"
SERVER_PORT="${SERVER_PORT:-3099}"
pids=()
# bunx forks vite as a child: stop children first, then the launcher
cleanup() { for p in ${pids[@]+"${pids[@]}"}; do pkill -P "$p" 2>/dev/null || true; kill "$p" 2>/dev/null || true; done; }
trap cleanup EXIT INT TERM

[ -d node_modules ] || bun install

bunx vitest run test/menuPosition.test.ts test/AgentList.test.tsx

if ! curl -sf -o /dev/null "http://localhost:$SERVER_PORT/api/agents"; then
  SERVER_PORT=3191
  SERVER_PORT=$SERVER_PORT node server/index.js >/tmp/review-192-server.log 2>&1 &
  pids+=($!)
fi

VITE_PORT=$VITE_PORT SERVER_PORT=$SERVER_PORT bunx vite --port "$VITE_PORT" >/tmp/review-192-vite.log 2>&1 &
pids+=($!)
for _ in $(seq 1 30); do curl -sf -o /dev/null "http://localhost:$VITE_PORT/agents" && break; sleep 1; done

cat <<EOF

Sichtprüfung: http://localhost:$VITE_PORT/agents   (kein Login; API auf :$SERVER_PORT)
  - Fenster niedrig ziehen, Rechtsklick auf die unterste Session: Menü rutscht nach oben, "Stop"/"Remove" sichtbar
  - Gruppen-Kebab (⋯) ganz unten, Shift+F10 auf unterer Zeile, Rechtsklick am rechten Rand
  - Fenster sehr niedrig (~300px): Menü scrollt intern
Beenden: Ctrl+C
EOF
wait
