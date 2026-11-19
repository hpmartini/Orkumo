#!/bin/bash
# Installs the Woodpecker agent that builds Orkumo's macOS release (release-mac) on this Mac:
# downloads the agent matching the server version (checksum verified), copies the agent secret from
# the CI host over ssh (never printed), and loads a LaunchAgent that keeps it running.
#   WOODPECKER_URL=https://ci.example.com WOODPECKER_SERVER=grpc.ci.example.com:443 \
#   SSH_HOST=ci-host COMPOSE_ENV=/path/to/woodpecker/.env scripts/release/mac-agent/install.sh
# WOODPECKER_URL: the server's web URL (version check); WOODPECKER_SERVER: its gRPC address the
# agent connects to; SSH_HOST: ssh alias of the CI host; COMPOSE_ENV: the env file there that holds
# WOODPECKER_AGENT_SECRET.
set -euo pipefail
SERVER_URL="${WOODPECKER_URL:?set WOODPECKER_URL (https://ci.example.com)}"
GRPC="${WOODPECKER_SERVER:?set WOODPECKER_SERVER (grpc.ci.example.com:443)}"
SSH_HOST="${SSH_HOST:?set SSH_HOST (ssh alias of the CI host)}"
COMPOSE_ENV="${COMPOSE_ENV:?set COMPOSE_ENV (path of the Woodpecker env file on the CI host)}"
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
echo "WOODPECKER_SERVER=$GRPC" >> "$DIR/agent.env"
command -v node > "$DIR/node-path"
install -m 755 "$SRC/run.sh" "$DIR/run.sh"
sed "s#__HOME__#$HOME#g" "$SRC/woodpecker-agent.plist.template" > "$PLIST"
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "Woodpecker agent $VERSION running ($LABEL); log: $DIR/agent.log"
