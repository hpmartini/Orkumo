#!/usr/bin/env bash
# Review #165: Orkumo without and with the Workflows premium module (hpmartini/DevHub-pro).
# Run from the root of a checkout of feat/165-workflow-premium (see PR "Review-Anleitung").
# Builds DevHub-pro in a temp dir, runs both test suites, then starts server + Vite on spare
# ports with the module loaded. Ctrl+C stops everything and removes the temp dir.
set -euo pipefail

PRO_BRANCH="${PRO_BRANCH:-feat/165-workflow-module}"
SERVER_PORT="${SERVER_PORT:-3199}"
VITE_PORT="${VITE_PORT:-3198}"
ROOT="$(git rev-parse --show-toplevel)"
MAIN="$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")"
TMP="$(mktemp -d)"
PIDS=()

cleanup() {
  for pid in "${PIDS[@]:-}"; do [ -n "$pid" ] && kill "$pid" 2>/dev/null || true; done
  rm -rf "$TMP"
}
trap cleanup EXIT INT TERM

cd "$ROOT"
echo "== Orkumo: install, tests, build (without module)"
bun install --silent
bunx vitest run
bun run build >/dev/null
if grep -rn "WorkflowView\|/api/workflows\|workflowsUrl" --include='*.ts' --include='*.tsx' --include='*.js' \
  App.tsx components hooks services server utils types.ts; then
  echo "FAIL: workflow view code left in Orkumo" >&2
  exit 1
fi

echo "== DevHub-pro ($PRO_BRANCH): clone, tests, build"
# Token via credential helper: stays out of argv and out of the clone's .git/config
git -c credential.helper= -c 'credential.helper=!f() { echo username=x-access-token; echo "password=$(gh auth token)"; }; f' \
  clone -q --branch "$PRO_BRANCH" https://github.com/hpmartini/DevHub-pro.git "$TMP/pro"
(cd "$TMP/pro" && bun install --silent && bun run test && bun run build)

# Board source and project dirs from the main checkout's settings, so the view shows the real MACC board
mkdir -p "$TMP/data"
for f in settings.json config.json; do [ -f "$MAIN/data/$f" ] && cp "$MAIN/data/$f" "$TMP/data/" || true; done

echo "== Server :$SERVER_PORT and Vite :$VITE_PORT with DEVHUB_PREMIUM_DIR=$TMP/pro/dist"
DEVHUB_PREMIUM_DIR="$TMP/pro/dist" DEVORBIT_DATA_PATH="$TMP/data" SERVER_PORT="$SERVER_PORT" \
  node server/index.js >"$TMP/server.log" 2>&1 &
PIDS+=($!)
SERVER_PORT="$SERVER_PORT" VITE_PORT="$VITE_PORT" bunx vite >"$TMP/vite.log" 2>&1 &
PIDS+=($!)

for _ in $(seq 1 60); do
  curl -sf "http://localhost:$SERVER_PORT/api/modules" >/dev/null && break
  sleep 1
done
echo "GET /api/modules: $(curl -s "http://localhost:$SERVER_PORT/api/modules")"

cat <<EOF

Sichtprüfung (kein Login):
  mit Modul:   http://localhost:$VITE_PORT/workflows   (Toggle in der Titelleiste, Cmd+P "Open Workflows")
  Board-GO:    http://localhost:$VITE_PORT/board       (Issue mit offenem Workflow-GO öffnen)
  ohne Modul:  Skript mit DEVHUB_PREMIUM_DIR=/nonexistent im Server-Aufruf, /workflows -> /dashboard
Logs: $TMP/server.log, $TMP/vite.log. Ctrl+C beendet alles.
EOF
wait
