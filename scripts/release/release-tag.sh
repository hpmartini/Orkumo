#!/usr/bin/env bash
# Release tag of a commit on main (Woodpecker, .woodpecker/release-*.yml).
#   release-tag.sh <sha>         tag of the release (draft or published) that targets <sha>; fails if none
#   release-tag.sh <sha> --next  same, else the next vX.Y.Z-rc.N for package.json's version
# rc.N counts on from the highest rc of that version among tags and releases, drafts included (old rcN tags too).
# Needs GH_REPO and GH_TOKEN. Runs on macOS's bash 3.2 as well.
set -euo pipefail
sha=${1:?usage: release-tag.sh <commit-sha> [--next]}
mode=${2:-}
if ! [[ $sha =~ ^[0-9a-f]{40}$ ]]; then
  echo "release-tag.sh: not a commit sha: $sha" >&2
  exit 2
fi

releases=$(gh api --paginate "repos/$GH_REPO/releases" --jq '.[] | "\(.tag_name) \(.target_commitish)"')
tag=$(awk -v sha="$sha" '$2 == sha { print $1; exit }' <<<"$releases")
if [ -n "$tag" ]; then
  echo "$tag"
  exit 0
fi
if [ "$mode" != --next ]; then
  echo "release-tag.sh: no release targets $sha (release-prepare creates it)" >&2
  exit 1
fi

base=$(node -p "require('./package.json').version")
if ! [[ $base =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "release-tag.sh: package.json version $base is not X.Y.Z" >&2
  exit 1
fi
names=$({
  gh api --paginate "repos/$GH_REPO/tags" --jq '.[].name'
  awk '{ print $1 }' <<<"$releases"
} | sort -u)
if grep -qx "v$base" <<<"$names"; then
  echo "release-tag.sh: v$base is released, raise the version in package.json for the next rcs" >&2
  exit 1
fi
last=$(grep -E "^v${base//./\\.}-rc\.?[0-9]+$" <<<"$names" | sed -E 's/.*-rc\.?//' | sort -n | tail -n 1 || true)
echo "v$base-rc.$((${last:-0} + 1))"
