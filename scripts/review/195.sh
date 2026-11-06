#!/usr/bin/env bash
# Review #195: other harnesses (Oh My Pi, OpenCode, Codex, Pi). Runs the tests, then a server on
# throwaway ports with a throwaway data dir and one throwaway project dir, drives the real paths
# (scripts/review/195-check.mjs: settings API, /api/pty rejections, one start per harness, no
# leftovers) and keeps the UI running for a look. Ctrl+C stops everything it started.
# Uses your real HOME so the harness CLIs find their logins; the harness checks send one short
# prompt each ("Reply with OK only") and close the pane right away.
set -euo pipefail
cd "$(dirname "$0")/../.."

VITE_PORT="${REVIEW_VITE_PORT:-3296}"
SERVER_PORT="${REVIEW_SERVER_PORT:-3295}" # not $SERVER_PORT: that may point at the running app
DATA=$(mktemp -d)
PROJECT="$DATA/projects/demo"
pids=()
# bunx forks vite as a child: stop children first, then the launcher
cleanup() {
  for p in ${pids[@]+"${pids[@]}"}; do pkill -P "$p" 2>/dev/null || true; kill "$p" 2>/dev/null || true; done
  rm -rf "$DATA"
}
trap cleanup EXIT INT TERM

[ -d node_modules ] || bun install

bunx vitest run test/harnessPolicy.test.js test/harnessDispatch.test.tsx test/AgentList.test.tsx \
  test/agentCardSettings.test.ts

mkdir -p "$PROJECT"
git -C "$PROJECT" init -q
printf '{ "directories": ["%s"] }\n' "$DATA/projects" >"$DATA/config.json"

start_server() { # args: optional prefix command (sandbox-exec …)
  DEVORBIT_DATA_PATH="$DATA" SERVER_PORT=$SERVER_PORT "$@" node server/index.js >>"$DATA/server.log" 2>&1 &
  SERVER_PID=$!
  pids+=($SERVER_PID)
  for _ in $(seq 1 60); do curl -sf -o /dev/null "http://localhost:$SERVER_PORT/api/agents/harnesses" && return; sleep 0.5; done
  echo "server did not start:"; tail -20 "$DATA/server.log"; exit 1
}
start_server
SERVER_PORT=$SERVER_PORT SERVER_PID=$SERVER_PID PROJECT_DIR="$PROJECT" node scripts/review/195-check.mjs

stop_server() { kill "$SERVER_PID"; wait "$SERVER_PID" 2>/dev/null || true; }

echo "== AC-7: server that cannot see opencode (macOS sandbox denies reading the binary)"
stop_server
if HIDE=$(command -v opencode) && command -v sandbox-exec >/dev/null; then
  REAL=$(node -e 'console.log(require("fs").realpathSync(process.argv[1]))' "$HIDE")
  start_server sandbox-exec -p "(version 1)(allow default)(deny file-read* (literal \"$HIDE\") (literal \"$REAL\"))"
  SERVER_PORT=$SERVER_PORT PROJECT_DIR="$PROJECT" node scripts/review/195-check.mjs --missing opencode
  stop_server
else
  echo "SKIP  AC-7 live (needs opencode installed and macOS sandbox-exec); unit test covers it"
fi

echo "== AC-2 restart: default harness survives"
start_server
after=$(curl -sf "http://localhost:$SERVER_PORT/api/settings/agent-view" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).dispatch.harness))')
[ "$after" = codex ] && echo "PASS  AC-2 dispatch.harness after restart = $after" || { echo "FAIL  AC-2 after restart = $after"; exit 1; }

VITE_PORT=$VITE_PORT SERVER_PORT=$SERVER_PORT bunx vite --port "$VITE_PORT" >"$DATA/vite.log" 2>&1 &
pids+=($!)
for _ in $(seq 1 60); do curl -sf -o /dev/null "http://localhost:$VITE_PORT/agents" && break; sleep 1; done

cat <<EOF

Sichtprüfung: http://localhost:$VITE_PORT/agents   (kein Login; API auf :$SERVER_PORT, Wegwerf-Daten)
  - Zahnrad → "Harness": Default steht auf Codex; Karten-Layout hat das Element "Harness"
  - "New task" (Cmd/Ctrl+K): Picker zeigt Codex vorgewählt, fehlende CLIs "(not installed)"
  - Ordner $PROJECT wählen, Harness Pi, Prompt "say hi" → Pane öffnet, Karte zeigt Badge "Pi"
  - Pane schließen → ps zeigt keinen pi-Prozess mehr
Beenden: Ctrl+C
EOF
wait
