#!/usr/bin/env bash
# Review #184 (view/mode rebuild): tests, lint, build, then the app on free ports.
# Run from the worktree root of feat/184-view-mode-umbau.
set -euo pipefail

SERVER_PORT="${SERVER_PORT:-3917}"
VITE_PORT="${VITE_PORT:-3918}"
pids=()
cleanup() {
  for pid in "${pids[@]:-}"; do [ -n "$pid" ] && kill "$pid" 2>/dev/null || true; done
}
trap cleanup EXIT INT TERM

cd "$(dirname "$0")/../.."
[ -d node_modules ] || bun install

bun run test:run
bun run lint
bun run build

SERVER_PORT="$SERVER_PORT" node server/index.js &
pids+=($!)
SERVER_PORT="$SERVER_PORT" VITE_PORT="$VITE_PORT" bunx vite &
pids+=($!)

curl -sf --retry 20 --retry-connrefused --retry-delay 1 -o /dev/null "http://localhost:$VITE_PORT/"
echo
echo "Review #184:  http://localhost:$VITE_PORT/agents"
echo "  Mode bar next to the robot; robot = context dashboard, rocket = global dashboard"
echo "  API: http://localhost:$SERVER_PORT/api/usage?days=7  ·  /api/usage/sessions?days=7  ·  /api/system/versions"
if [ ! -f "${CLAUDE_CONFIG_DIR:-$HOME/.claude}/devorbit-rate-limits.json" ]; then
  echo
  echo "Claude limits: no live source yet (only the stale ~/.claude.json cache)."
  echo "  To enable, set statusLine.command in your Claude settings to:"
  echo "  bash $(pwd)/scripts/claude-rate-limits-tap.sh <your current statusline command>"
fi
echo "Ctrl+C stops both servers."
wait
