#!/usr/bin/env bash
# Review #220 (Mesh): typecheck, lint and tests of Orkumo and the DevHub-pro mesh module, the mesh test over
# two real servers, then three real Orkumo instances on spare ports with throwaway data dirs and a
# claude stub each (fake sessions, never a real job):
#   A  - this checkout + mesh module, peer "Peer-B" via DEVORBIT_MESH_PEERS (manual URL)
#   B  - the peer: own server, DEVORBIT_REMOTE=true, mesh module
#   C  - without the module (AC-6: no picker)
# The e2e run (scripts/review/220-e2e.cjs) drives A in Chromium; screenshots + GIF land in
# ./review-220-shots. DevHub-pro: DEVHUB_PRO_SRC=<checkout> uses that checkout, else branch
# feat/220-mesh of ~/PROJECTS/DevHub-pro (or DEVHUB_PRO_DIR) is fetched into a throwaway worktree.
set -euo pipefail
cd "$(dirname "$0")/../.."
TMP=$(mktemp -d)
PIDS=()
PRO_WT=
set -m # each background job gets its own process group, so npx/vite children stop with it
cleanup() {
  for p in "${PIDS[@]:-}"; do [ -n "$p" ] && kill -TERM -- "-$p" 2>/dev/null || true; done
  [ -n "$PRO_WT" ] && git -C "${DEVHUB_PRO_DIR:-$HOME/PROJECTS/DevHub-pro}" worktree remove --force "$PRO_WT" 2>/dev/null || true
  rm -rf "$TMP"
}
trap cleanup EXIT INT TERM
free_port() { python3 -c 'import socket;s=socket.socket();s.bind(("",0));print(s.getsockname()[1]);s.close()'; }

[ -d node_modules ] || bun install
if [ -z "${SKIP_CHECKS:-}" ]; then # SKIP_CHECKS=1: only the instances and the e2e run
  npx tsc --noEmit -p .
  npx eslint . --quiet
  npx vitest run
fi
test -z "$(git grep -n 'meshService\|buildSshAttachArgs\|agents/remote' -- . ':!scripts/review/220.sh' ':!briefings')" # AC-10

PRO=${DEVHUB_PRO_SRC:-}
if [ -z "$PRO" ]; then
  PRO_DIR=${DEVHUB_PRO_DIR:-$HOME/PROJECTS/DevHub-pro}
  PRO_WT="$TMP/devhub-pro"
  git -C "$PRO_DIR" fetch -q origin feat/220-mesh
  git -C "$PRO_DIR" worktree add -q --detach "$PRO_WT" FETCH_HEAD
  PRO=$PRO_WT
fi
(cd "$PRO" && bun install >/dev/null && { [ -n "${SKIP_CHECKS:-}" ] || { npx tsc --noEmit && ORKUMO_DIR="$OLDPWD" NODE_ENV=test npx vitest run; }; } && bun run build >/dev/null)
test -f "$PRO/dist/mesh/index.js"

PROJ="$TMP/proj"
mkdir -p "$PROJ" "$TMP/modules"
ln -s "$PRO/dist/mesh" "$TMP/modules/mesh"
NOW=$(date +%s)000

# instance <name> <session json list>: data dir, claude stub, tailscale stub (no tailnet)
instance() {
  local d="$TMP/$1"
  mkdir -p "$d/bin" "$d/data" "$d/claude-home"
  echo "$2" >"$d/sessions.json"
  : >"$d/argv.log"
  echo "{\"directories\":[\"$PROJ\"]}" >"$d/data/config.json"
  printf '#!/bin/sh\nSTUB_STATE=%s STUB_LOG=%s STUB_NAME=%s exec python3 %s "$@"\n' \
    "$d/sessions.json" "$d/argv.log" "$1" "$PWD/scripts/review/220-claude-stub.py" >"$d/bin/claude"
  printf '#!/bin/sh\necho "{}"\n' >"$d/bin/tailscale"
  chmod +x "$d/bin/claude" "$d/bin/tailscale"
}
session() { echo "{\"kind\":\"background\",\"id\":\"$1\",\"cwd\":\"$PROJ\",\"name\":\"$2\",\"state\":\"working\",\"startedAt\":$NOW}"; }
instance local-a "[$(session local-a1 'Lokale Sitzung A')]"
instance peer-b "[$(session peer-b1 'Peer-Sitzung B1'),$(session peer-b2 'Peer-Sitzung B2')]"
instance plain-c "[$(session plain-c1 'Sitzung ohne Modul')]"

# server <name> <port> <modules dir> [extra env...]
server() {
  local d="$TMP/$1" port=$2 mods=$3
  shift 3
  env PATH="$d/bin:$PATH" SERVER_PORT="$port" DEVORBIT_DATA_PATH="$d/data" CLAUDE_CLI_PATH="$d/bin/claude" \
    CLAUDE_CONFIG_DIR="$d/claude-home" DEVHUB_PREMIUM_DIR="$mods" "$@" \
    node server/index.js >"$d/server.log" 2>&1 &
  PIDS+=($!)
}
A=$(free_port); B=$(free_port); C=$(free_port); VA=$(free_port); VC=$(free_port)
server peer-b "$B" "$TMP/modules" DEVORBIT_REMOTE=true
server local-a "$A" "$TMP/modules" DEVORBIT_MESH_PEERS="Peer-B=http://127.0.0.1:$B"
server plain-c "$C" "$TMP/none"
SERVER_PORT=$A VITE_PORT=$VA npx vite >"$TMP/vite-a.log" 2>&1 & PIDS+=($!)
SERVER_PORT=$C VITE_PORT=$VC npx vite >"$TMP/vite-c.log" 2>&1 & PIDS+=($!)
for _ in $(seq 1 60); do
  curl -sf "http://localhost:$VA" >/dev/null && curl -sf "http://localhost:$VC" >/dev/null &&
    curl -sf "http://127.0.0.1:$B/api/modules/mesh/hello" >/dev/null && curl -sf "http://localhost:$A/api/modules" >/dev/null && break
  sleep 1
done

(cd "$TMP" && echo '{"private":true}' >package.json && bun add playwright >/dev/null && node node_modules/playwright/cli.js install chromium >/dev/null)
mkdir -p "$TMP/shots"
NODE_PATH="$TMP/node_modules" node scripts/review/220-e2e.cjs "http://localhost:$VA" "http://localhost:$VC" \
  "http://127.0.0.1:$B" "$TMP" "$TMP/shots" || { tail -30 "$TMP"/*/server.log; rm -rf ./review-220-shots; cp -r "$TMP/shots" ./review-220-shots; exit 1; }
if command -v ffmpeg >/dev/null; then
  ffmpeg -loglevel error -y -i "$TMP/shots/flow.webm" -vf "fps=8,scale=1000:-1:flags=lanczos" "$TMP/shots/flow.gif"
fi
cp "$TMP/local-a/argv.log" "$TMP/shots/argv-local-a.log"
cp "$TMP/peer-b/argv.log" "$TMP/shots/argv-peer-b.log"
rm -rf ./review-220-shots && cp -r "$TMP/shots" ./review-220-shots
echo "Screenshots, GIF, argv logs: $PWD/review-220-shots"
echo "App A (mit Mesh): http://localhost:$VA/agents - Picker neben 'Agents' -> Peer-B. Ohne Modul: http://localhost:$VC/agents. Kein Login. Ctrl+C stoppt."
[ -n "${NO_WAIT:-}" ] || wait # NO_WAIT=1: exit after the checks (CI, agents)
