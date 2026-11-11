#!/usr/bin/env bash
# Writes the release compose file with DEVHUB_VERSION's default pinned to <version> (so a download starts exactly
# that release's images) plus the DB schema into <outdir>.
set -euo pipefail
version=${1:?usage: compose-assets.sh <version> <outdir>}
out=${2:?usage: compose-assets.sh <version> <outdir>}
mkdir -p "$out"
sed "s/\${DEVHUB_VERSION:-latest}/\${DEVHUB_VERSION:-$version}/" docker/docker-compose.release.yml >"$out/docker-compose.release.yml"
grep -q "devhub-api:\${DEVHUB_VERSION:-$version}" "$out/docker-compose.release.yml"
cp docker/init-db.sql "$out/init-db.sql"
