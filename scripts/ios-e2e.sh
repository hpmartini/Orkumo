#!/bin/bash
# End-to-end check of the iOS app in a simulator (Issue #120).
# Needs a running server with DEVORBIT_REMOTE=true and `tailscale serve` in front of it.
#   usage: scripts/ios-e2e.sh "<simulator name>" <https url> <local api url> <screenshot dir> [agent id]
#   With an agent id the test also attaches to that session and asks it for the sum of two random numbers.
#   e.g.:  scripts/ios-e2e.sh "iPhone 16" https://mac.tail1.ts.net http://127.0.0.1:3001 /tmp/ios-e2e
set -euo pipefail
SIM=$1 REMOTE=$2 LOCAL=$3 OUT=$4 AGENT=${5:-}
ROOT=$(cd "$(dirname "$0")/.." && pwd)
json() { python3 -c "import sys,json;print(eval('json.load(sys.stdin)' + sys.argv[1]))" "$1"; }
enc() { python3 -c "import sys,urllib.parse;print(urllib.parse.quote(sys.argv[1], safe=''))" "$1"; }

TOKEN=$(curl -sf "$LOCAL/api/remote/pairing" | json "['token']")
APP_ID=$(curl -sf "$LOCAL/api/apps" | json "[0]['id']")
APP_NAME=$(curl -sf "$LOCAL/api/apps" | json "[0]['name']")
MARKER=/tmp/devorbit-ios-e2e-$RANDOM
A=$((RANDOM + 10000)) B=$((RANDOM + 10000)) SUM=$((A + B))
UDID=$(xcrun simctl list devices available | grep "    $SIM (" | head -1 | sed -E 's/.*\(([0-9A-F-]{36})\).*/\1/')
rm -rf "$OUT" && mkdir -p "$OUT"

xcrun simctl boot "$UDID" 2>/dev/null || true
xcrun simctl terminate "$UDID" de.martinilabs.devorbit 2>/dev/null || true
xcrun simctl uninstall "$UDID" de.martinilabs.devorbit

cd "$ROOT/ios/App"
TEST_RUNNER_PAIR_LINK="devorbit://pair?url=$(enc "$REMOTE")&token=$TOKEN" \
TEST_RUNNER_TERMINAL_PATH="/$APP_NAME/$APP_ID" TEST_RUNNER_MARKER=$MARKER TEST_RUNNER_SCREENSHOT_DIR=$OUT \
TEST_RUNNER_ATTACH_ID=$AGENT TEST_RUNNER_ATTACH_PROMPT="Antworte nur mit dem Ergebnis von $A+$B" \
  xcodebuild test -project App.xcodeproj -scheme App -destination "id=$UDID" \
  -resultBundlePath "$OUT/result.xcresult" > "$OUT/xcodebuild.log" 2>&1 || true
grep -E "Test Case|error:|\*\* TEST" "$OUT/xcodebuild.log" | tail -5
# The typed shell command creates the marker on the Mac: proof the keystrokes reached the PTY.
[ -e "$MARKER" ] && echo "MARKER OK $MARKER" || { echo "MARKER MISSING $MARKER"; exit 1; }
grep -q "\*\* TEST SUCCEEDED \*\*" "$OUT/xcodebuild.log"
# The agent's answer (not part of the prompt) proves the attached terminal delivered the input.
if [ -n "$AGENT" ]; then
  claude logs "$AGENT" 2>/dev/null | grep -q "$SUM" && echo "ATTACH OK $AGENT ($A+$B=$SUM)" || { echo "ATTACH ANSWER $SUM MISSING $AGENT"; exit 1; }
fi
