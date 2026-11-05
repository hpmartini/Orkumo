#!/usr/bin/env bash
# Review #188: Cmd/Ctrl-click file paths in agent terminals. Runs the tests, starts a throwaway server
# (remote mode, so the token check is live) and Vite from this checkout, checks the endpoint with curl,
# then prints what to click. Ctrl+C stops everything and removes the demo files.
set -euo pipefail
cd "$(dirname "$0")/../.."

# own ports on purpose: a shell SERVER_PORT usually points at the running Orkumo, not this branch
SERVER_PORT="${REVIEW_188_SERVER_PORT:-3288}"
VITE_PORT="${REVIEW_188_VITE_PORT:-5288}"
if curl -s -o /dev/null "http://127.0.0.1:$SERVER_PORT/api/health"; then
  echo "Port $SERVER_PORT belegt; REVIEW_188_SERVER_PORT setzen" >&2
  exit 1
fi
demo="$(mktemp -d /tmp/orkumo-188.XXXX)"
pids=()
cleanup() {
  for p in ${pids[@]+"${pids[@]}"}; do pkill -P "$p" 2>/dev/null || true; kill "$p" 2>/dev/null || true; done
  rm -rf "$demo"
}
trap cleanup EXIT INT TERM

[ -d node_modules ] || bun install

bunx vitest run test/fileLinks.test.ts test/fileOpenRoutes.test.js test/remoteAccess.test.js

printf '%%PDF-1.1\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 100]>>endobj\ntrailer<</Root 1 0 R>>\n%%%%EOF\n' >"$demo/Rechnung-188.pdf"
printf '#!/bin/sh\ntouch %s/pwned\n' "$demo" >"$demo/run.command"
chmod +x "$demo/run.command"

DEVORBIT_REMOTE=true SERVER_PORT=$SERVER_PORT node server/index.js >/tmp/review-188-server.log 2>&1 &
pids+=($!)
VITE_PORT=$VITE_PORT SERVER_PORT=$SERVER_PORT bunx vite --port "$VITE_PORT" >/tmp/review-188-vite.log 2>&1 &
pids+=($!)
for _ in $(seq 1 30); do curl -sf -o /dev/null "http://127.0.0.1:$SERVER_PORT/api/health" && break; sleep 1; done
curl -sf -o /dev/null "http://127.0.0.1:$SERVER_PORT/api/health" || { echo "Server startet nicht, siehe /tmp/review-188-server.log" >&2; exit 1; }

api="http://127.0.0.1:$SERVER_PORT/api/files/open"
post() { curl -s -w " -> HTTP %{http_code}\n" -X POST "$api" -H 'Content-Type: application/json' "$@"; }
echo; echo "== Endpoint (echter Server) =="
echo -n "PDF öffnen (Vorschau geht auf):  "; post -d "{\"path\":\"$demo/Rechnung-188.pdf\"}"
echo -n "run.command (nur Finder):        "; post -d "{\"path\":\"$demo/run.command\"}"
echo -n "fehlt:                           "; post -d "{\"path\":\"$demo/fehlt.pdf\"}"
echo -n "/etc/hosts:                      "; post -d '{"path":"/etc/hosts"}'
echo -n "remote ohne Token:               "; post -H 'X-Forwarded-For: 100.64.0.9' -d "{\"path\":\"$demo/Rechnung-188.pdf\"}"
echo -n "fremde Origin:                   "; post -H 'Origin: https://evil.example' -d "{\"path\":\"$demo/Rechnung-188.pdf\"}"
sleep 1
[ -e "$demo/pwned" ] && { echo "FEHLER: run.command wurde ausgeführt"; exit 1; } || echo "run.command nicht ausgeführt: ok"

cat <<EOF

Sichtprüfung: http://localhost:$VITE_PORT/agents   (kein Login; API auf :$SERVER_PORT)
  - In einer Agent-Session (oder: cd $demo && claude --bg --model haiku "Gib nur aus: $demo/Rechnung-188.pdf ./run.command $demo/fehlt.pdf")
    den Agent anhängen, über einen Pfad fahren: unterstrichen
  - Klick ohne Cmd: markiert nur; Cmd-Klick: PDF -> Vorschau, ./run.command -> Finder + Toast, fehlt.pdf -> Fehler-Toast
  - URLs (https://…) öffnen weiter wie bisher
Beenden: Ctrl+C
EOF
wait
