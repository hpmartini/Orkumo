#!/usr/bin/env bash
# Review #178 (Quickreply readable): tests, then throwaway server + Vite + a seeded agent session with a table and a question.
set -euo pipefail
cd "$(dirname "$0")/../.."

PORT="${REVIEW_PORT:-3178}"
SERVER_PORT="${REVIEW_SERVER_PORT:-3197}"
SEED_NAME="review-178"
PIDS=()
SEED_ID=""

cleanup() {
  for pid in "${PIDS[@]}"; do kill "$pid" 2>/dev/null || true; done
  if [ -n "$SEED_ID" ]; then
    claude stop "$SEED_ID" >/dev/null 2>&1 || true
    claude rm "$SEED_ID" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT INT TERM

[ -d node_modules ] || bun install --frozen-lockfile

bunx vitest run test/terminalScreen.test.ts test/PeekPanel.test.tsx
bunx tsc --noEmit -p .

# Throwaway API server on its own port (file-based mode without a DB is fine for /agents)
SERVER_PORT="$SERVER_PORT" node server/index.js >/dev/null 2>&1 &
PIDS+=($!)
VITE_PORT="$PORT" SERVER_PORT="$SERVER_PORT" bunx vite --port "$PORT" --strictPort >/dev/null 2>&1 &
PIDS+=($!)

# Seed: a cheap background session that prints a box table and then waits on a numbered question
SEED_ID=$(claude --bg --model haiku -n "$SEED_NAME" \
  "Keine Tools außer AskUserQuestion benutzen. Gib eine Markdown-Tabelle mit den Spalten Kontext, Behalten, Entfernt und drei Zeilen (Agentic Workflow | Agent f44e021a | -; DevHub | Agent 82fd11a4 | -; Websites | - | 82fd11a4) aus. Frage danach per AskUserQuestion: 'Was soll mit dem Backup passieren?' mit den Optionen 'Backup behalten', 'Backup löschen', 'Später entscheiden'. Nach der Antwort bestätige die Wahl in einem Satz." \
  2>&1 | sed -n 's/.*claude stop \([0-9a-f]*\).*/\1/p' | head -1)

for _ in $(seq 60); do curl -sf -o /dev/null "http://localhost:$PORT/agents" && break; sleep 1; done
curl -sf -o /dev/null "http://localhost:$PORT/agents" || { echo "Vite did not come up on :$PORT"; exit 1; }

cat <<EOF

Review UI: http://localhost:$PORT/agents   (login: none; throwaway API on :$SERVER_PORT)
Seed session: $SEED_NAME (${SEED_ID:-not started}), waits on a question after ~30 s
  1. Select "$SEED_NAME", press Space (peek): words spaced, table aligned, scrolls sideways.
  2. Expand icon in the peek header: large view with choices and reply input; press 3 to answer; Esc back to the panel.
  3. Narrow the window below 768 px: peek fills the screen, large view still opens and closes.
Ctrl+C stops server, Vite and removes the seed session.
EOF
wait "${PIDS[1]}"
