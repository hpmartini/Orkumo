#!/usr/bin/env bash
# Self-test for rename-local-dir.sh on a throwaway clone with a linked worktree and fake HOME (#196).
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
T=$(mktemp -d)
trap 'rm -rf "$T"' EXIT
export HOME="$T/home_x" # "_" too: Claude Code maps every non-alphanumeric character to "-"
mkdir -p "$HOME/PROJECTS/Maple/config"
SRC="$HOME/PROJECTS/DevOrbitDashboard"
git init -q "$SRC"
git -C "$SRC" -c user.email=t@t -c user.name=t commit -q --allow-empty -m init
git -C "$SRC" remote add origin git@github.com:hpmartini/DevHub.git
git -C "$SRC" worktree add -q "$SRC/.claude/worktrees/wt1" -b wt1
key=$(printf '%s' "$SRC" | sed 's#[^A-Za-z0-9]#-#g')
mkdir -p "$HOME/.claude/projects/$key/memory" "$HOME/.claude/projects/$key--claude-worktrees-wt1"
echo '{ "devorbitdashboard": "'"$SRC"'" }' >"$HOME/PROJECTS/Maple/config/projekt-repos.json"
# Orkumo settings keyed by project ID (sha256(path)) plus a sibling folder that must stay untouched
pid() { printf '%s' "$1" | shasum -a 256 | cut -c1-16; }
export ORKUMO_DATA_DIRS="$T/data" SKIP_APP_CHECK=1
mkdir -p "$T/data" "$HOME/.claude/projects/$key-foo"
OLD_ID=$(pid "$SRC")
echo '{ "favorites": ["'"$OLD_ID"'"], "cwd": "'"$SRC"'/src", "other": "'"$SRC"'-foo" }' >"$T/data/settings.json"

"$here/rename-local-dir.sh" --dry-run
[[ -d "$SRC" ]] || { echo "FAIL: dry-run moved the folder"; exit 1; }

"$here/rename-local-dir.sh"
"$here/rename-local-dir.sh" # idempotent second run

DST="$HOME/PROJECTS/Orkumo"
nkey=$(printf '%s' "$DST" | sed 's#[^A-Za-z0-9]#-#g')
fail() { echo "FAIL: $*"; exit 1; }
[[ ! -e "$SRC" && -d "$DST" ]] || fail "folder not moved"
[[ "$(git -C "$DST" remote get-url origin)" == "git@github.com:hpmartini/Orkumo.git" ]] || fail "remote"
git -C "$DST/.claude/worktrees/wt1" status -s >/dev/null || fail "worktree broken"
git -C "$DST" worktree list | grep -q "$DST/.claude/worktrees/wt1" || fail "worktree list"
[[ -d "$HOME/.claude/projects/$nkey/memory" ]] || fail "claude memory folder"
[[ -d "$HOME/.claude/projects/$nkey--claude-worktrees-wt1" ]] || fail "claude worktree folder"
grep -q "\"$DST\"" "$HOME/PROJECTS/Maple/config/projekt-repos.json" || fail "maple mapping"
[[ -d "$HOME/.claude/projects/$key-foo" ]] || fail "sibling claude folder was moved"
S="$T/data/settings.json"
grep -q "\"$(pid "$DST")\"" "$S" || fail "project id not remapped"
grep -q "\"$DST/src\"" "$S" || fail "path not rewritten"
grep -q "\"$SRC-foo\"" "$S" || fail "sibling path rewritten"
ls "$T/data" | grep -q '^settings.json.bak-' || fail "no settings backup"
git -C "$DST" worktree list
echo "PASS rename-local-dir.sh"
