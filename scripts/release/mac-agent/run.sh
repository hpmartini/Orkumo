#!/bin/bash
# Woodpecker agent for Orkumo's release-mac workflow (local backend, this Mac).
# Installed by scripts/release/mac-agent/install.sh into ~/.local/share/woodpecker-agent and started
# by a LaunchAgent; the agent secret lives in agent.env next to it (mode 600).
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
set -a
# shellcheck disable=SC1091
. "$DIR/agent.env"
set +a
# gRPC through traefik on the CI host (TLS there, h2c to the server's :9000)
export WOODPECKER_SERVER="${WOODPECKER_SERVER:-woodpecker-grpc-tv94.srv1329780.hstgr.cloud:443}"
export WOODPECKER_GRPC_SECURE=true
export WOODPECKER_BACKEND=local
# Only workflows that ask for this backend (release-mac: `labels: backend: local`). Without the `!` a
# workflow without labels (every repo's lint/typecheck on the docker agent) may land here and fails:
# the local backend runs the image name as a command.
export WOODPECKER_AGENT_LABELS='!backend=local'
export WOODPECKER_HOSTNAME="mac-$(scutil --get LocalHostName 2>/dev/null || hostname -s)"
export WOODPECKER_MAX_WORKFLOWS=1
export WOODPECKER_AGENT_CONFIG_FILE="$DIR/agent.conf"
export WOODPECKER_BACKEND_LOCAL_TEMP_DIR="$DIR/work"
export WOODPECKER_HEALTHCHECK=false
# Tools release-mac needs: node, bun, gh, git (launchd starts with a bare PATH)
NODE_BIN="$(dirname "$(cat "$DIR/node-path" 2>/dev/null || echo /usr/local/bin/node)")"
export PATH="$NODE_BIN:$HOME/.bun/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
mkdir -p "$DIR/work"
exec "$DIR/woodpecker-agent"
