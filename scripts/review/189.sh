#!/usr/bin/env bash
# Review #189: chat UI for Claude Code in the agents workspace. Runs the #189 tests, then serves
# this branch on throwaway ports with a throwaway data dir and a throwaway project folder (your
# real settings and config stay untouched). Ctrl+C stops everything it started, chats included.
set -euo pipefail
cd "$(dirname "$0")/../.."

VITE_PORT="${REVIEW_VITE_PORT:-3192}"
# not SERVER_PORT: a shell that runs Orkumo exports it, and the review must not reach the live server
SERVER_PORT="${REVIEW_SERVER_PORT:-3191}"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/devorbit-189-XXXX")"
DATA_DIR="$TMP/data"
PROJECTS="$TMP/projects"
SANDBOX="$PROJECTS/chat-sandbox"
mkdir -p "$DATA_DIR" "$SANDBOX"
printf 'hello\n' >"$SANDBOX/hello.txt"
printf '{"directories":["%s"],"scanDepth":1,"excludePatterns":[]}\n' "$PROJECTS" >"$DATA_DIR/config.json"

pids=()
# bunx forks vite as a child: stop children first, then the launcher. The server ends its chats on exit.
cleanup() {
  for p in ${pids[@]+"${pids[@]}"}; do pkill -P "$p" 2>/dev/null || true; kill "$p" 2>/dev/null || true; done
  sleep 1
  rm -rf "$TMP"
}
trap cleanup EXIT INT TERM

[ -d node_modules ] || bun install

bunx vitest run test/chatService.test.js utils/chatEvents.test.ts

# No DB, migration or seed: chats live in memory and the Claude transcripts. DATABASE_URL points
# nowhere so a local Postgres stays untouched (the server runs without a DB).
DATABASE_URL=postgres://review@127.0.0.1:1/none DEVORBIT_DATA_PATH="$DATA_DIR" SERVER_PORT=$SERVER_PORT node server/index.js >"$TMP/server.log" 2>&1 &
pids+=($!)
VITE_PORT=$VITE_PORT SERVER_PORT=$SERVER_PORT bunx vite --port "$VITE_PORT" >"$TMP/vite.log" 2>&1 &
pids+=($!)
for _ in $(seq 1 30); do
  curl -sf -o /dev/null "http://localhost:$VITE_PORT/" && curl -sf -o /dev/null "http://localhost:$SERVER_PORT/api/agents/chat" && break
  sleep 1
done

# Guardrail on the real route: a folder outside the project dirs is refused, nothing is spawned
code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "http://localhost:$SERVER_PORT/api/agents/chat" \
  -H 'content-type: application/json' -d "{\"cwd\":\"$HOME\"}")
echo "POST /api/agents/chat with cwd outside the project dirs -> HTTP $code (expected 400)"
[ "$code" = 400 ]

cat <<EOF

Sichtprüfung: http://localhost:$VITE_PORT/agents   (kein Login; API auf :$SERVER_PORT, Wegwerf-Daten)
Projektordner: $SANDBOX  (Chat-Dialog: Ordner-Knopf, Pfad eintragen, "Use path")
  - "+ Chat": Nachricht schicken -> Antwort streamt, Markdown (Liste, Code, Tabelle) gerendert
  - Settings (Zahnrad) -> Permission mode "manual": "Create a.txt with hi" -> Allow/Deny-Karte;
    Deny -> keine Datei in $SANDBOX
  - Langer Auftrag, dann Stop (Quadrat) -> "Interrupted", nächste Nachricht geht
  - Bild per Drag & Drop / Einfügen anhängen -> Claude beschreibt es
  - Reload -> Verlauf wieder da; Terminal-Knopf -> claude --resume im Terminal-Tab mit gleichem Verlauf
  - Chat-Pane schließen -> pgrep -fl "permission-prompt-tool stdio" zeigt keinen Prozess mehr
Beenden: Ctrl+C
EOF
wait
