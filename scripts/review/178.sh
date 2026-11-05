#!/usr/bin/env bash
# Review #178 (Quickreply readable): tests, then a throwaway Vite on this checkout against the running DevOrbit server.
set -euo pipefail
cd "$(dirname "$0")/../.."

PORT="${REVIEW_PORT:-3178}"
SERVER_PORT="${SERVER_PORT:-3099}"

[ -d node_modules ] || bun install --frozen-lockfile

bunx vitest run test/terminalScreen.test.ts test/PeekPanel.test.tsx
bunx tsc --noEmit -p .

curl -sf -o /dev/null "http://localhost:$SERVER_PORT/api/agents" \
  || { echo "DevOrbit server not reachable on :$SERVER_PORT (set SERVER_PORT)"; exit 1; }

VITE_PORT="$PORT" SERVER_PORT="$SERVER_PORT" bunx vite --port "$PORT" >/dev/null 2>&1 &
VITE_PID=$!
trap 'kill "$VITE_PID" 2>/dev/null || true' EXIT INT TERM
until curl -sf -o /dev/null "http://localhost:$PORT/agents"; do sleep 1; done

cat <<EOF

Review UI: http://localhost:$PORT/agents   (login: none, uses the server on :$SERVER_PORT)
  1. Open any agent with a table or a question, press Space (peek): words spaced, tables aligned, scroll sideways.
  2. Click the expand icon in the peek header: large view, choices and reply input; Esc returns to the panel.
Ctrl+C stops Vite.
EOF
wait "$VITE_PID"
