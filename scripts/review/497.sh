#!/usr/bin/env bash
# Review MAGOS#497: unit tests, then the real app on spare ports (throwaway data dir, empty HOME,
# claude stub with two sessions whose state.json carries PR links) and an e2e run in Chromium: a PR
# pill opens a modal with exactly that PR, the overview opens only from "open PRs". Screenshots in $OUT.
set -euo pipefail
cd "$(dirname "$0")/../.."
OUT="${OUT:-$PWD/review-497-shots}"
TMP=$(mktemp -d)
PIDS=()
set -m
cleanup() { for p in "${PIDS[@]:-}"; do [ -n "$p" ] && kill -TERM -- "-$p" 2>/dev/null || true; done; rm -rf "$TMP"; }
trap cleanup EXIT INT TERM
free_port() { python3 -c 'import socket;s=socket.socket();s.bind(("",0));print(s.getsockname()[1]);s.close()'; }

[ -d node_modules ] || bun install
npx tsc --noEmit -p .
npx vitest run test/PullRequestModal.test.tsx

mkdir -p "$TMP/bin" "$TMP/claude-home/jobs" "$TMP/data" "$TMP/home" "$TMP/shots"
cat >"$TMP/bin/claude" <<'STUB'
#!/usr/bin/env bash
case "$1" in
  agents) echo '[{"kind":"background","id":"e2e497a","cwd":"/tmp","name":"imap-privatkonto","state":"idle","startedAt":1},{"kind":"background","id":"e2e497b","cwd":"/tmp","name":"dms-eingang","state":"idle","startedAt":2}]' ;;
  --version) echo "2.1.0 (Claude Code)" ;;
  *) exit 0 ;;
esac
STUB
mkdir -p "$TMP/claude-home/jobs/e2e497a" "$TMP/claude-home/jobs/e2e497b"
echo '{"children":[{"kind":"pr","href":"https://github.com/acme/orbit/pull/479","title":"IMAP fuer das Privatkonto","state":"merged"}]}' >"$TMP/claude-home/jobs/e2e497a/state.json"
echo '{"children":[{"kind":"pr","href":"https://github.com/acme/orbit/pull/494","title":"DMS-Eingang","state":"open"},{"kind":"pr","href":"https://github.com/acme/orbit/pull/495","title":"DMS-Tests","state":"open"}]}' >"$TMP/claude-home/jobs/e2e497b/state.json"
chmod +x "$TMP/bin/claude"

SERVER_PORT=$(free_port); VITE_PORT=$(free_port)
HOME="$TMP/home" SERVER_PORT=$SERVER_PORT DEVORBIT_DATA_PATH="$TMP/data" CLAUDE_CLI_PATH="$TMP/bin/claude" \
  CLAUDE_CONFIG_DIR="$TMP/claude-home" node server/index.js >"$TMP/server.log" 2>&1 & PIDS+=($!)
SERVER_PORT=$SERVER_PORT VITE_PORT=$VITE_PORT npx vite >"$TMP/vite.log" 2>&1 & PIDS+=($!)
URL="http://localhost:$VITE_PORT"
for _ in $(seq 1 60); do curl -sf "$URL" >/dev/null && curl -sf "http://localhost:$SERVER_PORT/api/agents" >/dev/null && break; sleep 1; done

(cd "$TMP" && echo '{"private":true}' >package.json && bun add playwright >/dev/null && node node_modules/playwright/cli.js install chromium >/dev/null)
rc=0
NODE_PATH="$TMP/node_modules" node scripts/review/497-e2e.cjs "$URL" "$TMP/shots" || rc=$?
mkdir -p "$OUT" && cp "$TMP"/shots/* "$OUT"/
echo "Screenshots: $OUT"
exit $rc
