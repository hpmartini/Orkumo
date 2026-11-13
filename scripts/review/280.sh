#!/usr/bin/env bash
# Review #280 (chat history): unit and component tests, then the app built unsigned into
# dist-electron/ and run with its own home (userData) and port; the installed app is not
# touched. The exports are the invented ones in test/fixtures/chat-exports. BUILD=0 reuses an
# existing build. Screenshots (the Chats view only) in $OUT.
set -euo pipefail
cd "$(dirname "$0")/../.."
OUT="${OUT:-$PWD/review-280-shots}"
APP="dist-electron/mac-arm64/Orkumo.app"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
free_port() { python3 -c 'import socket;s=socket.socket();s.bind(("",0));print(s.getsockname()[1]);s.close()'; }

[ -d node_modules ] || bun install
bunx vitest run test/chatHistoryService.test.js test/chatHistoryView.test.tsx test/ModeSwitcher.test.tsx
if [ "${BUILD:-1}" = 1 ] || [ ! -d "$APP" ]; then
  bun run build && bun run bundle:server && bun run electron:rebuild
  CSC_IDENTITY_AUTO_DISCOVERY=false bunx electron-builder --mac --arm64 --dir
fi
(cd "$TMP" && echo '{"private":true}' >package.json && bun add playwright >/dev/null)
mkdir -p "$OUT" "$TMP/home"
PORT=$(free_port)
NODE_PATH="$TMP/node_modules" node scripts/review/280-e2e.cjs "$PWD/$APP/Contents/MacOS/Orkumo" "$OUT" "$TMP/home" "$PORT"
lsof -ti "tcp:$PORT" -sTCP:LISTEN | xargs kill 2>/dev/null || true # the app's server child outlives the killed app
echo "Screenshots: $OUT"
