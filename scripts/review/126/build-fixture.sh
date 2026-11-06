#!/usr/bin/env bash
# Packages the #126 fixture app (scripts/review/126/fixture-main.mjs + electron/updater.js + electron-updater)
# with the repo's electron-builder, ad-hoc signed like CI without Apple secrets.
# Usage: build-fixture.sh <version> <out-dir> <electron-builder platform flags...>
#   e.g. build-fixture.sh 1.0.0-rc.1 /tmp/out --mac zip --arm64
set -euo pipefail
version=${1:?version}
out=${2:?out-dir}
shift 2
repo=$(cd "$(dirname "$0")/../../.." && pwd)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

mkdir -p "$work/app"
bun build "$repo/scripts/review/126/fixture-main.mjs" --target=node --format=cjs --external electron \
  --outfile "$work/app/main.cjs" >/dev/null
cat > "$work/app/package.json" <<JSON
{ "name": "orkumo-update-fixture", "productName": "OrkumoUpdateFixture", "version": "$version",
  "main": "main.cjs", "author": { "name": "Orkumo", "email": "noreply@example.invalid" }, "homepage": "https://example.invalid/orkumo", "description": "update e2e fixture", "license": "MIT" }
JSON
cat > "$work/builder.json" <<JSON
{
  "appId": "com.devorbit.update-fixture",
  "productName": "OrkumoUpdateFixture",
  "electronVersion": "$(node -p "require('$repo/node_modules/electron/package.json').version")",
  "directories": { "app": "$work/app", "output": "$out" },
  "files": ["main.cjs", "package.json"],
  "npmRebuild": false,
  "compression": "store",
  "mac": { "target": ["zip"], "hardenedRuntime": false, "gatekeeperAssess": false },
  "deb": { "compression": "gz" },
  "linux": { "target": ["AppImage"], "category": "Development", "maintainer": "Orkumo" },
  "publish": { "provider": "github", "owner": "hpmartini", "repo": "Orkumo" }
}
JSON
cd "$repo"
CSC_IDENTITY_AUTO_DISCOVERY=false bunx electron-builder --projectDir "$work/app" --config "$work/builder.json" \
  --publish never "$@"
