#!/usr/bin/env bash
# Review #214: the packaged Electron app (renderer on file://) loads a premium module's UI
# cross-origin from its server. Builds the app unsigned into dist-electron/ (skipped if present),
# then runs it twice with its own home (userData), port and module dir: with the module
# (PRO_DIST, default ~/PROJECTS/DevHub-pro/dist) and without. The installed app is not touched.
set -euo pipefail
cd "$(dirname "$0")/../.."
PRO_DIST="${PRO_DIST:-$HOME/PROJECTS/DevHub-pro/dist}"
OUT="${OUT:-$PWD/review-214-shots}"
APP="dist-electron/mac-arm64/Orkumo.app"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
free_port() { python3 -c 'import socket;s=socket.socket();s.bind(("",0));print(s.getsockname()[1]);s.close()'; }

[ -d node_modules ] || bun install
bunx vitest run test/electronOrigin.test.js
if [ ! -d "$APP" ]; then
  bun run build && bun run bundle:server && bun run electron:rebuild
  CSC_IDENTITY_AUTO_DISCOVERY=false bunx electron-builder --mac --arm64 --dir
fi
(cd "$TMP" && echo '{"private":true}' >package.json && bun add playwright >/dev/null)
mkdir -p "$OUT" "$TMP/empty"

run() { # <with|without> <module dir>
  local home="$TMP/home-$1" port
  port=$(free_port)
  mkdir -p "$home"
  echo "== $1 module ($2)"
  GH_TOKEN="$(gh auth token)" NODE_PATH="$TMP/node_modules" node scripts/review/214-e2e.cjs \
    "$PWD/$APP/Contents/MacOS/Orkumo" "$OUT" "$2" "$home" "$port" "$1"
  lsof -ti "tcp:$port" -sTCP:LISTEN | xargs kill 2>/dev/null || true # the app's server child outlives the killed app
}
run with "$PRO_DIST"
run without "$TMP/empty"
echo "Screenshots: $OUT"
