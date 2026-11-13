#!/bin/bash
# Installs the Woodpecker agent that builds Orkumo's macOS release (release-mac) on this Mac:
# downloads the agent matching the server version (checksum verified), copies the agent secret from
# the CI host over ssh (never printed), and loads a LaunchAgent that keeps it running.
#   scripts/release/mac-agent/install.sh [ssh-host]   (default VPS-hosti)
set -euo pipefail
SSH_HOST="${1:-VPS-hosti}"
SERVER_URL="https://woodpecker-ci-tv94.srv1329780.hstgr.cloud"
COMPOSE_ENV="/docker/woodpecker-ci-tv94/.env"
SRC="$(cd "$(dirname "$0")" && pwd)"
DIR="$HOME/.local/share/woodpecker-agent"
LABEL="com.orkumo.woodpecker-agent"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"

for tool in node bun gh git; do command -v "$tool" >/dev/null || { echo "missing: $tool" >&2; exit 1; }; done
mkdir -p "$DIR"
VERSION="v$(curl -fsS "$SERVER_URL/version" | node -pe 'JSON.parse(require("fs").readFileSync(0)).version')"
ARCH="$(uname -m | sed 's/x86_64/amd64/')"
(
  cd "$DIR"
  gh release download "$VERSION" -R woodpecker-ci/woodpecker --clobber \
    -p "woodpecker-agent_darwin_${ARCH}.tar.gz" -p checksums.txt
  grep "woodpecker-agent_darwin_${ARCH}.tar.gz" checksums.txt | shasum -a 256 -c -
  tar xzf "woodpecker-agent_darwin_${ARCH}.tar.gz"
  xattr -c woodpecker-agent 2>/dev/null || true
)
umask 077
ssh -o BatchMode=yes "$SSH_HOST" "grep ^WOODPECKER_AGENT_SECRET= $COMPOSE_ENV" > "$DIR/agent.env"
command -v node > "$DIR/node-path"
install -m 755 "$SRC/run.sh" "$DIR/run.sh"
sed "s#__HOME__#$HOME#g" "$SRC/woodpecker-agent.plist.template" > "$PLIST"
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "Woodpecker agent $VERSION running ($LABEL); log: $DIR/agent.log"
