#!/usr/bin/env bash
# Uploads files to the GitHub release <tag>, drafts included, over REST (release-id.sh: no GraphQL draft
# lookup), replacing an asset of the same name like `gh release upload --clobber`. An installer (~160 MB)
# takes minutes, so a failed upload gets three more tries with growing pauses; fails after the fourth.
# Needs GH_REPO and GH_TOKEN (else `gh auth token`).
set -euo pipefail
tag=${1:?usage: upload-files.sh <tag> <file>...}
shift
if [ $# -eq 0 ]; then
  echo "upload-files.sh: no files for $tag" >&2
  exit 1
fi
id=$("$(dirname "$0")/release-id.sh" "$tag")
token=${GH_TOKEN:-$(gh auth token)}

upload() {
  local f=$1 name old a
  name=$(basename "$f")
  old=$(gh api --paginate "repos/$GH_REPO/releases/$id/assets" --jq '.[] | "\(.id) \(.name)"' |
    awk -v n="$name" '$2 == n { print $1 }') || return 1
  for a in $old; do
    gh api -X DELETE "repos/$GH_REPO/releases/assets/$a" || return 1
  done
  curl -sS --fail-with-body -o /dev/null -X POST -T "$f" \
    -H "Authorization: Bearer $token" -H 'Content-Type: application/octet-stream' \
    "https://uploads.github.com/repos/$GH_REPO/releases/$id/assets?name=$name"
}

for f in "$@"; do
  echo "upload $(basename "$f") ($(du -h "$f" | cut -f1))"
  for attempt in 1 2 3 4; do
    upload "$f" && break
    [ "$attempt" = 4 ] && exit 1
    echo "upload of $f failed (attempt $attempt), retrying in $((attempt * 20)) s" >&2
    sleep $((attempt * 20))
  done
done
