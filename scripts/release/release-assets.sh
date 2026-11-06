#!/usr/bin/env bash
# Lists the files of an electron-builder output dir that belong on the GitHub release (#126):
# installers, update metadata (*.yml) and *.blockmap, never builder-debug.yml.
# --no-mac-yml leaves out *-mac.yml: arm64 and x64 each write one, the merge-mac-yml job uploads the merged file.
set -euo pipefail
dir=${1:?usage: release-assets.sh <dir> [--no-mac-yml]}
mode=${2:-}
find "$dir" -maxdepth 1 -type f \
  \( -name '*.dmg' -o -name '*.zip' -o -name '*.AppImage' -o -name '*.deb' -o -name '*.rpm' \
     -o -name '*.blockmap' -o -name '*.yml' \) ! -name 'builder-debug.yml' |
  { if [ "$mode" = --no-mac-yml ]; then grep -v -- '-mac\.yml$' || true; else cat; fi; } |
  sort
