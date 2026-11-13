#!/usr/bin/env bash
# Review #251 (quick window): builds the app unsigned into dist-electron/ and runs it with its
# own home (userData), port and a test shortcut; the installed app is not touched. BUILD=0 reuses
# an existing build. Screenshots in $OUT.
set -euo pipefail
cd "$(dirname "$0")/../.."
OUT="${OUT:-$PWD/review-251-shots}"
APP="dist-electron/mac-arm64/Orkumo.app"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
free_port() { python3 -c 'import socket;s=socket.socket();s.bind(("",0));print(s.getsockname()[1]);s.close()'; }

[ -d node_modules ] || bun install
if [ "${BUILD:-1}" = 1 ] || [ ! -d "$APP" ]; then
  bun run build && bun run bundle:server && bun run electron:rebuild
  CSC_IDENTITY_AUTO_DISCOVERY=false bunx electron-builder --mac --arm64 --dir
fi
(cd "$TMP" && echo '{"private":true}' >package.json && bun add playwright >/dev/null)
mkdir -p "$OUT" "$TMP/home"
PORT=$(free_port)
NODE_PATH="$TMP/node_modules" node scripts/review/251-e2e.cjs "$PWD/$APP/Contents/MacOS/Orkumo" "$OUT" "$TMP/home" "$PORT"
lsof -ti "tcp:$PORT" -sTCP:LISTEN | xargs kill 2>/dev/null || true # the app's server child outlives the killed app
echo "Screenshots: $OUT"
