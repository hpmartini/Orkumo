#!/usr/bin/env bash
# Review #187: context dialog resizable, project directories collapsible. Runs the dialog tests, then
# serves this branch's UI on a throwaway Vite port. API: the Orkumo server already running on :3099
# (real project scan), else a throwaway server from this checkout. Ctrl+C stops everything it started.
# --check: also runs the browser measurement (AC-1..3) against the real scan and exits.
set -euo pipefail
cd "$(dirname "$0")/../.."

VITE_PORT="${VITE_PORT:-3187}"
SERVER_PORT="${SERVER_PORT:-3099}"
pids=()
tmp=""
# bunx forks vite as a child: stop children first, then the launcher
cleanup() {
  for p in ${pids[@]+"${pids[@]}"}; do pkill -P "$p" 2>/dev/null || true; kill "$p" 2>/dev/null || true; done
  [ -z "$tmp" ] || rm -rf "$tmp"
}
trap cleanup EXIT INT TERM

[ -d node_modules ] || bun install

bunx vitest run test/ContextDialog.test.tsx

if ! curl -sf -o /dev/null "http://localhost:$SERVER_PORT/api/apps"; then
  SERVER_PORT=3188
  SERVER_PORT=$SERVER_PORT node server/index.js >/tmp/review-187-server.log 2>&1 &
  pids+=($!)
fi

VITE_PORT=$VITE_PORT SERVER_PORT=$SERVER_PORT bunx vite --port "$VITE_PORT" --strictPort >/tmp/review-187-vite.log 2>&1 &
pids+=($!)
for _ in $(seq 1 30); do curl -sf -o /dev/null "http://localhost:$VITE_PORT/" && break; sleep 1; done

if [ "${1:-}" = "--check" ]; then
  # playwright-core 1.49.1 drives Chromium build 1148; kept out of package.json on purpose
  tmp="$(mktemp -d)"
  npm install --silent --prefix "$tmp" playwright-core@1.49.1 >/dev/null
  NODE_PATH="$tmp/node_modules" node "$tmp/node_modules/playwright-core/cli.js" install chromium >/dev/null
  NODE_PATH="$tmp/node_modules" node scripts/review/187-measure.cjs "http://localhost:$VITE_PORT/"
  exit 0
fi

cat <<MSG

Sichtprüfung: http://localhost:$VITE_PORT/   (kein Login; API auf :$SERVER_PORT)
  - "+" (Neuer Kontext) oben in der Kontextleiste oder Stift an einem Kontext-Tab
  - Ecke unten rechts ziehen: Dialog und Projektliste wachsen; schließen, neu laden, öffnen: Größe bleibt
  - Verzeichniskopf klicken (oder Tab + Enter): klappt nur dieses; Buttons neben "Projekte filtern": alle ein/aus
  - Filtertext tippen: Treffer auch aus eingeklappten Verzeichnissen sichtbar
Beenden: Ctrl+C
MSG
wait
