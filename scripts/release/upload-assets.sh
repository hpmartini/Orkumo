#!/usr/bin/env bash
# Uploads the release files of an electron-builder output dir (release-assets.sh) to the GitHub release <tag>,
# drafts included; extra arguments go to release-assets.sh. Fails on the first failed upload or an empty dir.
set -euo pipefail
tag=${1:?usage: upload-assets.sh <tag> <dir> [--no-mac-yml]}
shift
files=$("$(dirname "$0")/release-assets.sh" "$@")
if [ -z "$files" ]; then
  echo "upload-assets.sh: no release files in $1" >&2
  exit 1
fi
while IFS= read -r f; do
  gh release upload "$tag" "$f" --clobber
done <<<"$files"
