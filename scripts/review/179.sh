#!/usr/bin/env bash
# Review #179: searchable slice picker on /board. Runs the board tests, then serves this branch's UI
# on a throwaway Vite port. API: the Orkumo server already running on :3099 (real board data),
# else a throwaway server from this checkout. Ctrl+C stops everything it started.
set -euo pipefail
cd "$(dirname "$0")/../.."

VITE_PORT="${VITE_PORT:-3198}"
SERVER_PORT="${SERVER_PORT:-3099}"
pids=()
# bunx forks vite as a child: stop children first, then the launcher
cleanup() { for p in ${pids[@]+"${pids[@]}"}; do pkill -P "$p" 2>/dev/null || true; kill "$p" 2>/dev/null || true; done; }
trap cleanup EXIT INT TERM

[ -d node_modules ] || bun install

bunx vitest run test/board.test.ts

if ! curl -sf -o /dev/null "http://localhost:$SERVER_PORT/api/board/settings"; then
  SERVER_PORT=3197
  SERVER_PORT=$SERVER_PORT node server/index.js >/tmp/review-179-server.log 2>&1 &
  pids+=($!)
fi

VITE_PORT=$VITE_PORT SERVER_PORT=$SERVER_PORT bunx vite --port "$VITE_PORT" >/tmp/review-179-vite.log 2>&1 &
pids+=($!)
for _ in $(seq 1 30); do curl -sf -o /dev/null "http://localhost:$VITE_PORT/board" && break; sleep 1; done

cat <<EOF

Sichtprüfung: http://localhost:$VITE_PORT/board   (kein Login; API auf :$SERVER_PORT)
  - Repo-Auswahl öffnen (Button "Alle (n)" links im Header), "dev" tippen, Enter
  - Slice-Art auf "Label" stellen, Auswahl erneut öffnen
Beenden: Ctrl+C
EOF
wait
