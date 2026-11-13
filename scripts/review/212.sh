#!/usr/bin/env bash
# Review #212: unit tests, then the real app on spare ports with a throwaway data dir and an e2e
# run in Chromium: a workspace stored in the old flat shape, tab C dropped below pane A (B keeps
# the full height and its shell), browser pane dragged onto the tab strip, reload. Screenshots
# and a GIF land in ./review-212-shots (or $OUT). `claude` is a stub and the server gets an empty HOME: no real sessions in the pictures.
set -euo pipefail
cd "$(dirname "$0")/../.."
OUT="${OUT:-$PWD/review-212-shots}"
TMP=$(mktemp -d)
PIDS=()
set -m
cleanup() { for p in "${PIDS[@]:-}"; do [ -n "$p" ] && kill -TERM -- "-$p" 2>/dev/null || true; done; rm -rf "$TMP"; }
trap cleanup EXIT INT TERM
free_port() { python3 -c 'import socket;s=socket.socket();s.bind(("",0));print(s.getsockname()[1]);s.close()'; }

[ -d node_modules ] || bun install
npx tsc --noEmit -p .
npx vitest run utils/agentWorkspace.test.ts test/useAgentWorkspace.test.ts

mkdir -p "$TMP/bin" "$TMP/claude-home/jobs" "$TMP/data" "$TMP/home" "$TMP/panes"/{A,B,C,D} "$TMP/shots"
printf '#!/usr/bin/env bash\ncase "$1" in agents) echo "[]" ;; --version) echo "2.1.0 (Claude Code)" ;; *) exit 0 ;; esac\n' >"$TMP/bin/claude"
chmod +x "$TMP/bin/claude"

SERVER_PORT=$(free_port); VITE_PORT=$(free_port)
HOME="$TMP/home" SERVER_PORT=$SERVER_PORT DEVORBIT_DATA_PATH="$TMP/data" CLAUDE_CLI_PATH="$TMP/bin/claude" \
  CLAUDE_CONFIG_DIR="$TMP/claude-home" node server/index.js >"$TMP/server.log" 2>&1 & PIDS+=($!)
SERVER_PORT=$SERVER_PORT VITE_PORT=$VITE_PORT npx vite >"$TMP/vite.log" 2>&1 & PIDS+=($!)
URL="http://localhost:$VITE_PORT"
for _ in $(seq 1 60); do curl -sf "$URL" >/dev/null && curl -sf "http://localhost:$SERVER_PORT/api/agents" >/dev/null && break; sleep 1; done

(cd "$TMP" && echo '{"private":true}' >package.json && bun add playwright >/dev/null && node node_modules/playwright/cli.js install chromium >/dev/null)
NODE_PATH="$TMP/node_modules" node scripts/review/212-e2e.cjs "$URL" "$TMP/shots" "$TMP/panes" "http://localhost:$SERVER_PORT/api/health"
if command -v ffmpeg >/dev/null; then
  ffmpeg -loglevel error -y -i "$TMP/shots/flow.webm" -vf "fps=8,scale=1000:-1:flags=lanczos" "$TMP/shots/flow.gif"
fi
rm -f "$TMP/shots/flow.webm"
mkdir -p "$OUT" && cp "$TMP"/shots/* "$OUT"/
echo "Screenshots + GIF: $OUT"
