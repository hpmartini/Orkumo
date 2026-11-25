#!/usr/bin/env bash
# Uploads the release files of an electron-builder output dir (release-assets.sh) to the GitHub release <tag>,
# drafts included (upload-files.sh); extra arguments go to release-assets.sh. Fails on an empty dir.
set -euo pipefail
tag=${1:?usage: upload-assets.sh <tag> <dir> [--no-mac-yml]}
shift
files=()
while IFS= read -r f; do
  [ -n "$f" ] && files+=("$f")
done < <("$(dirname "$0")/release-assets.sh" "$@")
if [ ${#files[@]} -eq 0 ]; then
  echo "upload-assets.sh: no release files in $1" >&2
  exit 1
fi
exec "$(dirname "$0")/upload-files.sh" "$tag" "${files[@]}"
