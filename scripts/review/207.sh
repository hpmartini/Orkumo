#!/usr/bin/env bash
# Review #207: unit + component tests, then the real app on spare ports with a throwaway data dir
# and a throwaway git repo + worktree, an e2e run in Chromium (right-click → "Open terminal here" →
# `pwd -P`, close kills the shell) with screenshots and a GIF, and the app left running until Ctrl+C.
# `claude agents --json` is the one stand-in: a stub lists one agent in the worktree, so the run
# needs no real agent and never touches ~/.claude.
set -euo pipefail
cd "$(dirname "$0")/../.."
TMP=$(mktemp -d)
PIDS=()
set -m # each background job gets its own process group, so npx/vite children stop with it
cleanup() { for p in "${PIDS[@]:-}"; do [ -n "$p" ] && kill -TERM -- "-$p" 2>/dev/null || true; done; rm -rf "$TMP"; }
trap cleanup EXIT INT TERM
free_port() { python3 -c 'import socket;s=socket.socket();s.bind(("",0));print(s.getsockname()[1]);s.close()'; }

[ -d node_modules ] || bun install
npx tsc --noEmit -p .
npx vitest run utils/agentWorkspace.test.ts test/openTerminal.test.tsx

# Throwaway project with a linked worktree, and the claude stub that lists one agent in it
PROJ="$TMP/e2e207-proj"; WT="$PROJ/.claude/worktrees/feat-e2e"
git init -q "$PROJ" && git -C "$PROJ" commit -q --allow-empty -m init
git -C "$PROJ" worktree add -q "$WT" -b feat-e2e
mkdir -p "$TMP/bin" "$TMP/claude-home/jobs" "$TMP/data"
cat >"$TMP/bin/claude" <<EOF
#!/usr/bin/env bash
case "\$1" in
  agents) echo '[{"kind":"background","id":"e2e207","cwd":"$WT","name":"e2e-worker","state":"working","startedAt":$(date +%s)000}]' ;;
  --version) echo '2.1.0 (Claude Code)' ;;
  *) exit 0 ;;
esac
EOF
chmod +x "$TMP/bin/claude"

SERVER_PORT=$(free_port); VITE_PORT=$(free_port)
SERVER_PORT=$SERVER_PORT DEVORBIT_DATA_PATH="$TMP/data" CLAUDE_CLI_PATH="$TMP/bin/claude" \
  CLAUDE_CONFIG_DIR="$TMP/claude-home" node server/index.js >"$TMP/server.log" 2>&1 & PIDS+=($!)
SERVER_PORT=$SERVER_PORT VITE_PORT=$VITE_PORT npx vite >"$TMP/vite.log" 2>&1 & PIDS+=($!)
URL="http://localhost:$VITE_PORT"
for _ in $(seq 1 60); do curl -sf "$URL" >/dev/null && curl -sf "http://localhost:$SERVER_PORT/api/agents" >/dev/null && break; sleep 1; done

(cd "$TMP" && echo '{"private":true}' >package.json && bun add playwright >/dev/null && node node_modules/playwright/cli.js install chromium >/dev/null)
mkdir -p "$TMP/shots"
NODE_PATH="$TMP/node_modules" node scripts/review/207-e2e.cjs "$URL" "$TMP/shots" "$PROJ" "$WT"
if command -v ffmpeg >/dev/null; then
  ffmpeg -loglevel error -y -i "$TMP/shots/flow.webm" -vf "fps=8,scale=1000:-1:flags=lanczos" "$TMP/shots/flow.gif"
fi
rm -rf ./review-207-shots && cp -r "$TMP/shots" ./review-207-shots
echo "Screenshots + GIF: $PWD/review-207-shots"
echo "App: $URL/agents (no login, own data dir). Rechtsklick auf Gruppe e2e207-proj oder Agent e2e-worker → Open terminal here. Ctrl+C stoppt."
wait
