#!/usr/bin/env bash
# Smoke test: start the release compose from an empty dir with images tagged as on GHCR, no repo files besides the two release assets.
# Usage: scripts/docker-release-smoke.sh [repo-dir]  (needs Docker; cleans up its own containers and volumes)
set -u

WT=${1:-$(cd "$(dirname "$0")/.." && pwd)}
V=0.0.0-ac3
docker build -q -f "$WT/Dockerfile.api" -t "ghcr.io/hpmartini/devhub-api:$V" "$WT" || exit 1
docker build -q -f "$WT/Dockerfile.frontend" -t "ghcr.io/hpmartini/devhub-frontend:$V" "$WT" || exit 1
D=$(mktemp -d)
cp "$WT/docker/docker-compose.release.yml" "$WT/docker/init-db.sql" "$D/"
mkdir -p "$D/projects"
cd "$D" && echo "workdir: $D ($(ls | tr '\n' ' '))"
# isolated project name + port so a running local stack is not touched; pull=never proves no registry access is needed
export DEVHUB_VERSION=$V DEVORBIT_PORT=3999 DEVORBIT_PROJECTS_DIR="$D/projects" COMPOSE_PROJECT_NAME=devhub-ac3
docker compose -f docker-compose.release.yml up -d --pull never --wait --wait-timeout 180
rc=$?
docker compose -f docker-compose.release.yml ps --format 'table {{.Service}}\t{{.Image}}\t{{.Status}}'
echo "curl /api/health via frontend port:"
code=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3999/api/health); echo "HTTP $code"
curl -s -o /dev/null -w "GET / HTTP %{http_code}\n" http://localhost:3999/
echo "compose up --wait exit $rc"
# no set -e on purpose: teardown must run even when the stack failed
docker compose -f docker-compose.release.yml down -v >/dev/null 2>&1
[ "$rc" = 0 ] && [ "$code" = 200 ]
