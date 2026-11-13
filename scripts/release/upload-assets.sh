#!/usr/bin/env bash
# Uploads the release files of an electron-builder output dir (release-assets.sh) to the GitHub release <tag>,
# drafts included; extra arguments go to release-assets.sh. An installer (~160 MB) takes minutes, so a
# dropped connection gets two more tries; fails after the third failed upload of a file or on an empty dir.
set -euo pipefail
tag=${1:?usage: upload-assets.sh <tag> <dir> [--no-mac-yml]}
shift
files=$("$(dirname "$0")/release-assets.sh" "$@")
if [ -z "$files" ]; then
  echo "upload-assets.sh: no release files in $1" >&2
  exit 1
fi
while IFS= read -r f; do
  echo "upload $(basename "$f") ($(du -h "$f" | cut -f1))"
  for attempt in 1 2 3; do
    gh release upload "$tag" "$f" --clobber && break
    [ "$attempt" = 3 ] && exit 1
    echo "upload of $f failed (attempt $attempt), retrying in 15 s" >&2
    sleep 15
  done
done <<<"$files"
