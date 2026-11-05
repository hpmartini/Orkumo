#!/usr/bin/env bash
# Review #190: ~/.claude (or $CLAUDE_CONFIG_DIR) as project directory. Runs the #190 tests, then
# serves this branch on throwaway ports with a throwaway data dir (your real config.json stays
# untouched). Ctrl+C stops everything it started.
set -euo pipefail
cd "$(dirname "$0")/../.."

VITE_PORT="${REVIEW_VITE_PORT:-3190}"
# not SERVER_PORT: a shell that runs Orkumo exports it, and the review must not reach the live server
SERVER_PORT="${REVIEW_SERVER_PORT:-3189}"
DATA_DIR="$(mktemp -d "${TMPDIR:-/tmp}/devorbit-190-XXXX")"
pids=()
# bunx forks vite as a child: stop children first, then the launcher
cleanup() {
  for p in ${pids[@]+"${pids[@]}"}; do pkill -P "$p" 2>/dev/null || true; kill "$p" 2>/dev/null || true; done
  rm -rf "$DATA_DIR"
}
trap cleanup EXIT INT TERM

[ -d node_modules ] || bun install

bunx vitest run test/claudeConfigDir.test.js

DEVORBIT_DATA_PATH="$DATA_DIR" SERVER_PORT=$SERVER_PORT node server/index.js >"$DATA_DIR/server.log" 2>&1 &
pids+=($!)
VITE_PORT=$VITE_PORT SERVER_PORT=$SERVER_PORT bunx vite --port "$VITE_PORT" >"$DATA_DIR/vite.log" 2>&1 &
pids+=($!)
for _ in $(seq 1 30); do curl -sf -o /dev/null "http://localhost:$VITE_PORT/" && break; sleep 1; done

cat <<EOF

Sichtprüfung: http://localhost:$VITE_PORT/   (kein Login; API auf :$SERVER_PORT, Wegwerf-Config)
  - Settings öffnen (Command Palette "Open settings"), unter "Add directory" $HOME/.claude eintragen, Add
    -> steht in der Liste, kein Fehlerbanner
  - $HOME/.ssh oder $HOME/.foo eintragen -> Fehlerbanner wie bisher
  - /agents: neuen Agent mit Ordner ~/.claude starten
Beenden: Ctrl+C
EOF
wait
