#!/usr/bin/env bash
# Review #194: "working" counts only agents that really run a turn. Runs the tests, starts a throwaway
# API server from this checkout (needs it: the fix is server-side), compares its working agents with an
# independent count from ~/.claude/jobs, then serves the UI. Ctrl+C stops everything it started.
set -euo pipefail
cd "$(dirname "$0")/../.."

SERVER_PORT="${SERVER_PORT:-3194}"
VITE_PORT="${VITE_PORT:-5194}"
pids=()
# bunx forks vite as a child: stop children first, then the launcher
cleanup() { for p in ${pids[@]+"${pids[@]}"}; do pkill -P "$p" 2>/dev/null || true; kill "$p" 2>/dev/null || true; done; }
trap cleanup EXIT INT TERM

[ -d node_modules ] || bun install

bunx vitest run test/workingState.test.tsx test/agentService.test.js test/agentSessions.test.ts \
  test/agentOverview.test.ts test/agentInput.test.ts test/agentCardOrigin.test.ts

SERVER_PORT=$SERVER_PORT node server/index.js >/tmp/review-194-server.log 2>&1 &
pids+=($!)
for _ in $(seq 1 60); do curl -sf -o /dev/null "http://localhost:$SERVER_PORT/api/agents" && break; sleep 2; done

echo "--- AC-4: this branch (:$SERVER_PORT)"
node scripts/review/194-check.mjs "http://localhost:$SERVER_PORT" || true
if curl -sf -o /dev/null "http://localhost:3099/api/agents"; then
  echo "--- before: running Orkumo (:3099, main)"
  node scripts/review/194-check.mjs http://localhost:3099 || true
fi

VITE_PORT=$VITE_PORT SERVER_PORT=$SERVER_PORT bunx vite --port "$VITE_PORT" >/tmp/review-194-vite.log 2>&1 &
pids+=($!)
for _ in $(seq 1 30); do curl -sf -o /dev/null "http://localhost:$VITE_PORT/agents" && break; sleep 1; done

cat <<EOF

Sichtprüfung: http://localhost:$VITE_PORT/agents   (kein Login; API auf :$SERVER_PORT)
  - Zähler "n working" in der Kopfzeile mit deiner laufenden App vergleichen
  - Chip "working" klicken: nur Agents mit laufendem Turn (Spinner); idle Goals zeigen "∙",
    Warten auf eigene Hintergrund-Shell zeigt "◷"
Beenden: Ctrl+C
EOF
wait
