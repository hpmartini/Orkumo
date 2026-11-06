#!/usr/bin/env bash
# Review #242: tests, then the real app on spare ports with a throwaway data dir seeded with a
# pre-#181 settings.json (`cardDetails: "hover"`, no marker). The e2e run checks the migration
# (API + file) and the row menu in click and hover mode, with screenshots; the app keeps running
# until Ctrl+C (REVIEW_NO_WAIT=1 exits after the e2e run). `claude agents --json` is a stub listing
# one agent, so ~/.claude is never touched.
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
npx vitest run test/cardDetailsMigration.test.js test/agentCardSettings.test.ts test/openTerminal.test.tsx

mkdir -p "$TMP/bin" "$TMP/claude-home/jobs" "$TMP/data" "$TMP/work"
echo '{"agentView":{"cardDetails":"hover"},"version":1}' >"$TMP/data/settings.json"
cat >"$TMP/bin/claude" <<EOF
#!/usr/bin/env bash
case "\$1" in
  agents) echo '[{"kind":"background","id":"e2e242","cwd":"$TMP/work","name":"e2e-worker","state":"working","startedAt":$(date +%s)000}]' ;;
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
NODE_PATH="$TMP/node_modules" node scripts/review/242-e2e.cjs "$URL" "$TMP/shots" "$TMP/data/settings.json"
rm -rf ./review-242-shots && cp -r "$TMP/shots" ./review-242-shots
echo "Screenshots: $PWD/review-242-shots"
echo "App: $URL/agents (no login, own data dir). Rechtsklick auf e2e-worker: im Modus click kein 'Keep details open'. Ctrl+C stoppt."
[ -n "${REVIEW_NO_WAIT:-}" ] || wait
