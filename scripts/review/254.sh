#!/usr/bin/env bash
# Review #254: unit tests, then the real app on spare ports (throwaway data dir, empty HOME, claude
# stub) and an e2e run in Chromium against a stubbed board API: pickers of "Neues Issue" close each
# other and on outside clicks, `#` lists repositories, the issue is created in the chosen status,
# and the dialog opened from /agents offers the status too. Screenshots in $OUT.
set -euo pipefail
cd "$(dirname "$0")/../.."
OUT="${OUT:-$PWD/review-254-shots}"
TMP=$(mktemp -d)
PIDS=()
set -m
cleanup() { for p in "${PIDS[@]:-}"; do [ -n "$p" ] && kill -TERM -- "-$p" 2>/dev/null || true; done; rm -rf "$TMP"; }
trap cleanup EXIT INT TERM
free_port() { python3 -c 'import socket;s=socket.socket();s.bind(("",0));print(s.getsockname()[1]);s.close()'; }

[ -d node_modules ] || bun install
npx tsc --noEmit -p .
npx vitest run test/IssueCreateModal254.test.tsx test/IssueCreateRepoHash.test.tsx

mkdir -p "$TMP/bin" "$TMP/claude-home/jobs" "$TMP/data" "$TMP/home" "$TMP/shots"
printf '#!/usr/bin/env bash\ncase "$1" in agents) echo "[]" ;; --version) echo "2.1.0 (Claude Code)" ;; *) exit 0 ;; esac\n' >"$TMP/bin/claude"
chmod +x "$TMP/bin/claude"

SERVER_PORT=$(free_port); VITE_PORT=$(free_port)
HOME="$TMP/home" SERVER_PORT=$SERVER_PORT DEVORBIT_DATA_PATH="$TMP/data" CLAUDE_CLI_PATH="$TMP/bin/claude" \
  CLAUDE_CONFIG_DIR="$TMP/claude-home" node server/index.js >"$TMP/server.log" 2>&1 & PIDS+=($!)
SERVER_PORT=$SERVER_PORT VITE_PORT=$VITE_PORT npx vite >"$TMP/vite.log" 2>&1 & PIDS+=($!)
URL="http://localhost:$VITE_PORT"
for _ in $(seq 1 60); do curl -sf "$URL" >/dev/null && curl -sf "http://localhost:$SERVER_PORT/api/agents" >/dev/null && break; sleep 1; done

(cd "$TMP" && echo '{"private":true}' >package.json && bun add playwright >/dev/null && node node_modules/playwright/cli.js install chromium >/dev/null)
rc=0
NODE_PATH="$TMP/node_modules" node scripts/review/254-e2e.cjs "$URL" "$TMP/shots" || rc=$?
mkdir -p "$OUT" && cp "$TMP"/shots/* "$OUT"/
echo "Screenshots: $OUT"
exit $rc
