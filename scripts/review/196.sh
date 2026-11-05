#!/usr/bin/env bash
# Review #196: rename to Orkumo. Runs the rename checks (remaining old names, Electron userData pin,
# local-dir script on a throwaway copy, tests), then serves this branch on throwaway ports with a
# throwaway data dir. Ctrl+C stops everything it started.
set -euo pipefail
cd "$(dirname "$0")/../.."

VITE_PORT="${REVIEW_VITE_PORT:-3196}"
SERVER_PORT="${REVIEW_SERVER_PORT:-3195}" # not $SERVER_PORT: that may point at the running app
DATA=$(mktemp -d)
pids=()
# bunx forks vite as a child: stop children first, then the launcher
cleanup() {
  for p in ${pids[@]+"${pids[@]}"}; do pkill -P "$p" 2>/dev/null || true; kill "$p" 2>/dev/null || true; done
  rm -rf "$DATA"
}
trap cleanup EXIT INT TERM

[ -d node_modules ] || bun install

echo "== Remaining old names (only persisted/technical identifiers expected; categorized in docs/evidence/196/ac1-restliste.md)"
git grep -n -i "devorbit\|devhub\|dev orbit" -- . ':!briefings' ':!graphify-out' ':!CHANGELOG.md' ':!docs/landing-evidence' ':!docs/evidence/196' | wc -l

bunx vitest run test/electronUserData.test.js test/board.test.ts test/boardService.test.js \
  test/agentCardOrigin.test.ts utils/directoryGroups.test.ts test/AgentList.test.tsx
bash scripts/rename-local-dir.test.sh | tail -1

mkdir -p "$DATA/home" # throwaway HOME: no real agents, sessions or projects on screen
HOME="$DATA/home" DEVORBIT_DATA_PATH="$DATA" SERVER_PORT=$SERVER_PORT node server/index.js >"$DATA/server.log" 2>&1 &
pids+=($!)
VITE_PORT=$VITE_PORT SERVER_PORT=$SERVER_PORT bunx vite --port "$VITE_PORT" >"$DATA/vite.log" 2>&1 &
pids+=($!)
for _ in $(seq 1 60); do curl -sf -o /dev/null "http://localhost:$VITE_PORT/dashboard" && break; sleep 1; done

cat <<EOF

Sichtprüfung: http://localhost:$VITE_PORT/dashboard   (kein Login; API auf :$SERVER_PORT, Wegwerf-Daten)
  - Tab-Titel und App-Shell zeigen "Orkumo"; /agents, /code, /board ansehen
  - Landingpage lokal: bun run landing:build && bun run landing:serve  → http://localhost:4173/Orkumo/
  - Ordner-Umzug (nach dem Merge, alle Sessions im Ordner beendet): scripts/rename-local-dir.sh --dry-run, dann ohne Flag
Beenden: Ctrl+C
EOF
wait
