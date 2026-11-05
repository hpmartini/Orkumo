#!/usr/bin/env bash
# Review #191: Pull Requests mode with filters, clusters and sorting on /pulls. Runs the PR tests,
# then serves this branch's UI on a throwaway Vite port. API: the Orkumo server already running on
# :3099 (real agents and PRs), else a throwaway server from this checkout. Ctrl+C stops everything it started.
set -euo pipefail
cd "$(dirname "$0")/../.."

VITE_PORT="${VITE_PORT:-3198}"
SERVER_PORT="${SERVER_PORT:-3099}"
pids=()
# bunx forks vite as a child: stop children first, then the launcher
cleanup() { for p in ${pids[@]+"${pids[@]}"}; do pkill -P "$p" 2>/dev/null || true; kill "$p" 2>/dev/null || true; done; }
trap cleanup EXIT INT TERM

[ -d node_modules ] || bun install

bunx tsc --noEmit
bunx vitest run test/pullRequestQuery.test.ts test/pullRequestsView.test.tsx test/ModeSwitcher.test.tsx

if ! curl -sf -o /dev/null "http://localhost:$SERVER_PORT/api/agents"; then
  SERVER_PORT=3197
  SERVER_PORT=$SERVER_PORT node server/index.js >/tmp/review-191-server.log 2>&1 &
  pids+=($!)
fi

VITE_PORT=$VITE_PORT SERVER_PORT=$SERVER_PORT bunx vite --port "$VITE_PORT" >/tmp/review-191-vite.log 2>&1 &
pids+=($!)
for _ in $(seq 1 30); do curl -sf -o /dev/null "http://localhost:$VITE_PORT/agents" && break; sleep 1; done

cat <<EOF

Sichtprüfung: http://localhost:$VITE_PORT/agents   (kein Login; API auf :$SERVER_PORT)
  - Modusleiste über den Agents: "Pull Requests" klicken -> /pulls
  - Filter (CI, Merge, Review, Draft, Autor, Base, Has agent, Freitext) setzen, Zähler "x of y" prüfen
  - "Group by" auf Repository/Agent, Sortierung + Richtung wechseln, URL ansehen, neu laden
Beenden: Ctrl+C
EOF
wait
