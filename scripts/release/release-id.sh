#!/usr/bin/env bash
# Prints the id of the GitHub release <tag>, drafts included, from the REST release list.
# `gh release upload/edit/view <tag>` find a draft only through GraphQL; when that lookup fails, gh reports
# "release not found" and hides the real error (cli/cli pkg/cmd/release/shared/fetch.go), which cost rc.73.
# Needs GH_REPO and GH_TOKEN. Fails if no release has <tag>.
set -euo pipefail
tag=${1:?usage: release-id.sh <tag>}
releases=$(gh api --paginate "repos/$GH_REPO/releases" --jq '.[] | "\(.tag_name) \(.id)"')
id=$(awk -v tag="$tag" '$1 == tag { print $2; exit }' <<<"$releases")
if [ -z "$id" ]; then
  echo "release-id.sh: no release $tag in $GH_REPO" >&2
  exit 1
fi
echo "$id"
