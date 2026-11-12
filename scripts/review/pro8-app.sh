#!/usr/bin/env bash
# Review DevHub-pro#8 (macOS client against another machine's server): the packaged app, started with
# ORKUMO_REMOTE, connects to a second Orkumo server in remote mode (the app's own bundled server, run
# headless on a spare port with a throwaway data dir and a claude stub), shows its project and agent
# and opens a terminal there, through a relay that stands in for `tailscale serve`. The installed app is not touched. BUILD=0 reuses an existing build.
set -euo pipefail
cd "$(dirname "$0")/../.."
OUT="${OUT:-$PWD/review-pro8-shots}"
APP="$PWD/dist-electron/mac-arm64/Orkumo.app"
BIN="$APP/Contents/MacOS/Orkumo"
RES="$APP/Contents/Resources"
TMP=$(mktemp -d)
SERVER_PID=
cleanup() {
  [ -n "$SERVER_PID" ] && kill "$SERVER_PID" 2>/dev/null || true
  rm -rf "$TMP"
}
trap cleanup EXIT INT TERM
free_port() { python3 -c 'import socket;s=socket.socket();s.bind(("",0));print(s.getsockname()[1]);s.close()'; }

[ -d node_modules ] || bun install
if [ "${BUILD:-1}" = 1 ] || [ ! -d "$APP" ]; then
  bun run build && bun run bundle:server && bun run electron:rebuild
  CSC_IDENTITY_AUTO_DISCOVERY=false bunx electron-builder --mac --arm64 --dir
  codesign --force --deep -s - "$APP" # --dir alone leaves a broken signature
fi
(cd "$TMP" && echo '{"private":true}' >package.json && bun add playwright >/dev/null)

PROJ="$TMP/projects/pro8-projekt"
mkdir -p "$OUT" "$PROJ" "$TMP/bin" "$TMP/server-home" "$TMP/server-data" "$TMP/claude-home/jobs" "$TMP/client-home"
git init -q "$PROJ" && git -C "$PROJ" commit -q --allow-empty -m init
echo "{\"directories\":[\"$TMP/projects\"]}" >"$TMP/server-data/config.json"
cat >"$TMP/bin/claude" <<EOF
#!/usr/bin/env bash
case "\$1" in
  agents) echo '[{"kind":"background","id":"e2epro8","cwd":"$PROJ","name":"pro8-worker","state":"working","startedAt":$(date +%s)000}]' ;;
  --version) echo '2.1.0 (Claude Code)' ;;
  *) exit 0 ;;
esac
EOF
chmod +x "$TMP/bin/claude"

PORT=$(free_port)
MARK="remote-$RANDOM$RANDOM"
# Headless: no ELECTRON_MODE, so the server treats the client's file:// renderer as a foreign origin
(cd "$RES/app.asar.unpacked/dist-server" && exec env -u ELECTRON_MODE ELECTRON_RUN_AS_NODE=1 \
  HOME="$TMP/server-home" DEVORBIT_REMOTE=true SERVER_PORT="$PORT" DEVORBIT_DATA_PATH="$TMP/server-data" \
  CLAUDE_CLI_PATH="$TMP/bin/claude" CLAUDE_CONFIG_DIR="$TMP/claude-home" DEVHUB_PREMIUM_DIR="$TMP/no-modules" \
  NODE_ENV=production NODE_PATH="$RES/app.asar/node_modules:$RES/app.asar.unpacked/node_modules" \
  PRO8_MARK="$MARK" "$BIN" index.js) >"$TMP/server.log" 2>&1 &
SERVER_PID=$!
for _ in $(seq 1 60); do
  curl -sf "http://127.0.0.1:$PORT/api/config" >/dev/null && break
  sleep 0.5
done
TOKEN=$(curl -sf "http://127.0.0.1:$PORT/api/remote/pairing" | python3 -c 'import json,sys;print(json.load(sys.stdin)["token"])') ||
  { tail -20 "$TMP/server.log"; exit 1; }

NODE_PATH="$TMP/node_modules" node scripts/review/pro8-app-e2e.cjs "$BIN" "$OUT" "$TMP/client-home" "$PORT" "$TOKEN" "$MARK" "$(free_port)"
echo "Screenshots: $OUT"
