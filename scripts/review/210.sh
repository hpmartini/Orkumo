#!/usr/bin/env bash
# Review #210: agent card highlights. Unit tests, typecheck, then the real app on spare ports with a
# throwaway data dir and a claude stub listing three agents (never touches ~/.claude), an e2e run in
# Chromium (open two agents, click a third, move by arrow key) with screenshots, and the app left
# running for a look until Ctrl+C.
set -euo pipefail
cd "$(dirname "$0")/../.."
TMP=$(mktemp -d)
PIDS=()
set -m # each background job gets its own process group, so npx/vite children stop with it
cleanup() { for p in "${PIDS[@]:-}"; do [ -n "$p" ] && kill -TERM -- "-$p" 2>/dev/null || true; done; rm -rf "$TMP"; }
trap cleanup EXIT INT TERM
free_port() { python3 -c 'import socket;s=socket.socket();s.bind(("",0));print(s.getsockname()[1]);s.close()'; }

[ -d node_modules ] || bun install
[ "${SKIP_UNIT:-}" = 1 ] || { npx vitest run; npx tsc --noEmit; }

mkdir -p "$TMP/bin" "$TMP/claude-home/jobs" "$TMP/data" "$TMP/proj"
NOW=$(date +%s)000
cat >"$TMP/bin/claude" <<EOF
#!/usr/bin/env bash
case "\$1" in
  agents) echo '[{"kind":"background","id":"e2e210a","cwd":"$TMP/proj","name":"open-agent","state":"working","startedAt":$NOW},{"kind":"background","id":"e2e210b","cwd":"$TMP/proj","name":"attached-agent","state":"working","startedAt":$NOW},{"kind":"background","id":"e2e210c","cwd":"$TMP/proj","name":"clicked-agent","state":"working","startedAt":$NOW},{"kind":"background","id":"e2e210d","cwd":"$TMP/proj","name":"keyboard-agent","state":"working","startedAt":$NOW}]' ;;
  --version) echo '2.1.0 (Claude Code)' ;;
  *) sleep 600 ;; # attach/logs: stay connected like a live agent
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
NODE_PATH="$TMP/node_modules" node scripts/review/210-e2e.cjs "$URL" "$TMP/shots"
rm -rf ./review-210-shots && cp -r "$TMP/shots" ./review-210-shots
echo "Screenshots: $PWD/review-210-shots"
echo "App: $URL/agents (kein Login, eigene Daten). Doppelklick öffnet, Klick wählt nur aus; Ctrl+C stoppt."
[ "${NO_WAIT:-}" = 1 ] || wait
