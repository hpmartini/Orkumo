#!/usr/bin/env bash
# Review #236: typecheck + tests, then the real app on spare ports with a throwaway data dir and a
# claude stub (fake ids, never a real job): one respawned background job (fa4e0236, writes b0b00236) plus two processes on its
# transcripts, like the 2026-11-06 case. The stub logs every argv, so the e2e run proves what
# opening a tab starts. Screenshots + GIF land in ./review-236-shots; the app stays up until Ctrl+C.
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
npx vitest run

ORIG=fa4e0236-0000-4000-8000-000000000001
RESPAWN=b0b00236-0000-4000-8000-000000000002
WT="$TMP/demo-landing/.claude/worktrees/issue-10"
mkdir -p "$WT" "$TMP/bin" "$TMP/claude-home/jobs/fa4e0236" "$TMP/data"
NOW=$(date +%s)000
cat >"$TMP/claude-home/jobs/fa4e0236/state.json" <<EOF
{"state":"idle","name":"MACC demo-landing#10","sessionId":"$ORIG","resumeSessionId":"$RESPAWN","cwd":"$WT","createdAt":"2026-11-04T00:54:41.949Z"}
EOF
echo "{\"directories\":[\"$TMP/demo-landing\"]}" >"$TMP/data/config.json"
ARGV_LOG="$TMP/claude-argv.log"; : >"$ARGV_LOG"
cat >"$TMP/bin/claude" <<EOF
#!/usr/bin/env bash
echo "\$*" >>"$ARGV_LOG"
case "\$1" in
  agents) echo '[{"kind":"background","id":"fa4e0236","cwd":"$WT","name":"MACC demo-landing#10","sessionId":"$ORIG","state":"idle","startedAt":$NOW},
{"kind":"interactive","pid":3993,"cwd":"$WT","name":"MACC demo-landing#10","sessionId":"$ORIG","startedAt":$NOW},
{"kind":"interactive","pid":19245,"cwd":"$WT","name":"MACC demo-landing#10","sessionId":"$RESPAWN","startedAt":$NOW}]' ;;
  attach) echo "attached \$2"; exec cat >/dev/null ;;
  --version) echo '2.1.318 (Claude Code)' ;;
  -p) sid=; prev=; for a in "\$@"; do [ "\$prev" = --resume ] && sid=\$a; prev=\$a; done
      echo "{\"type\":\"system\",\"subtype\":\"init\",\"session_id\":\"\$sid\"}"; exec cat >/dev/null ;;
  *) exit 0 ;;
esac
EOF
chmod +x "$TMP/bin/claude"

SERVER_PORT=$(free_port); VITE_PORT=$(free_port)
PATH="$TMP/bin:$PATH" SERVER_PORT=$SERVER_PORT DEVORBIT_DATA_PATH="$TMP/data" \
  CLAUDE_CLI_PATH="$TMP/bin/claude" CLAUDE_CONFIG_DIR="$TMP/claude-home" \
  node server/index.js >"$TMP/server.log" 2>&1 & PIDS+=($!)
SERVER_PORT=$SERVER_PORT VITE_PORT=$VITE_PORT npx vite >"$TMP/vite.log" 2>&1 & PIDS+=($!)
URL="http://localhost:$VITE_PORT"
for _ in $(seq 1 60); do curl -sf "$URL" >/dev/null && curl -sf "http://localhost:$SERVER_PORT/api/agents" >/dev/null && break; sleep 1; done

(cd "$TMP" && echo '{"private":true}' >package.json && bun add playwright >/dev/null && node node_modules/playwright/cli.js install chromium >/dev/null)
mkdir -p "$TMP/shots"
NODE_PATH="$TMP/node_modules" node scripts/review/236-e2e.cjs "$URL" "$TMP/shots" "$ARGV_LOG" || { tail -40 "$TMP/server.log"; exit 1; }
if command -v ffmpeg >/dev/null; then
  ffmpeg -loglevel error -y -i "$TMP/shots/flow.webm" -vf "fps=8,scale=1000:-1:flags=lanczos" "$TMP/shots/flow.gif"
fi
cp "$ARGV_LOG" "$TMP/shots/claude-argv.log"
rm -rf ./review-236-shots && cp -r "$TMP/shots" ./review-236-shots
echo "Screenshots, GIF, argv log: $PWD/review-236-shots"
echo "App: $URL/agents (no login, own data dir). Agent 'MACC demo-landing#10' anklicken: attach statt Kopie. Ctrl+C stoppt."
[ -n "${NO_WAIT:-}" ] || wait # NO_WAIT=1: exit after the checks (CI, agents)
