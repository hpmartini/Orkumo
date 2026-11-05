#!/usr/bin/env bash
# Moves the local checkout from ~/PROJECTS/DevOrbitDashboard to ~/PROJECTS/Orkumo (issue #196) and
# fixes everything that hangs on the path: git remote, linked worktrees, Claude Code memory/session
# folders, Maple' project mapping, Orkumo's own settings (project IDs hash the path). Run it after the
# rename PR is merged, from outside the folder (e.g. `cd ~`), with no Claude/dev process inside the
# folder and the desktop app quit. Idempotent: a second run only repeats the fix-ups.
#
#   ~/PROJECTS/DevOrbitDashboard/scripts/rename-local-dir.sh [--dry-run]
#   SRC / DST / MAPLE_REPOS / ORKUMO_DATA_DIRS (colon-separated) override the defaults (self-test).
set -euo pipefail

DRY=0
[[ "${1:-}" == "--dry-run" ]] && DRY=1
SRC="${SRC:-$HOME/PROJECTS/DevOrbitDashboard}"
DST="${DST:-$HOME/PROJECTS/Orkumo}"
MAPLE_REPOS="${MAPLE_REPOS:-$HOME/PROJECTS/Maple/config/projekt-repos.json}"
# Desktop app (pinned userData, electron/constants.js) and the dev server's local data/
ORKUMO_DATA_DIRS="${ORKUMO_DATA_DIRS:-$HOME/Library/Application Support/devorbit-dashboard/data:$DST/data}"
CLAUDE_PROJECTS="$HOME/.claude/projects"
HERE=$(cd "$(dirname "$0")" && pwd)
NODE_SCRIPT="$HERE/remap-project-path.mjs"
[[ "$HERE" == "$SRC"/* ]] && NODE_SCRIPT="$DST${HERE#"$SRC"}/remap-project-path.mjs" # moves with the folder

run() { if ((DRY)); then echo "would: $*"; else echo "+ $*"; "$@"; fi; }
key() { printf '%s' "$1" | sed 's#[^A-Za-z0-9]#-#g'; } # Claude Code's folder key for a cwd

if [[ -d "$SRC" && -e "$DST" ]]; then echo "both $SRC and $DST exist, resolve by hand" >&2; exit 1; fi
if [[ ! -d "$SRC" && ! -d "$DST" ]]; then echo "neither $SRC nor $DST exists" >&2; exit 1; fi

if [[ -d "$SRC" ]]; then
  # A process whose cwd is inside the folder would keep working on a path that no longer exists.
  command -v lsof >/dev/null || { echo "lsof missing, cannot check for processes inside $SRC" >&2; exit 1; }
  # lsof exits 1 on unreadable mounts (e.g. Time Machine) while still listing everything else.
  cwds=$(lsof -a -d cwd -Fpn 2>/dev/null || true)
  [[ -n "$cwds" ]] || { echo "lsof returned nothing, cannot check for processes inside $SRC" >&2; exit 1; }
  busy=$(awk -v s="$SRC" '/^p/{p=substr($0,2)} /^n/{n=substr($0,2); if (n==s || index(n, s"/")==1) print p" "n}' <<<"$cwds")
  busy=$(grep -v "^$$ " <<<"$busy" || true)
  if [[ -n "$busy" ]]; then
    echo "processes still work inside $SRC (pid cwd), stop them first (run this script from outside):" >&2
    echo "$busy" >&2
    ((DRY)) || exit 1
  fi
  # The desktop app keeps settings in memory and would write the old paths back.
  if [[ -z "${SKIP_APP_CHECK:-}" ]] && pgrep -f '(DevOrbitDashboard|Orkumo)\.app/Contents/MacOS/' >/dev/null; then
    echo "quit the Orkumo/DevOrbitDashboard desktop app first" >&2
    ((DRY)) || exit 1
  fi
  SRC_P=$(cd "$SRC" && pwd -P) # git reports physical paths (/private/var vs /var)
  worktrees=$(git -C "$SRC" worktree list --porcelain | awk '/^worktree /{print substr($0,10)}' | tail -n +2)
  run mv "$SRC" "$DST"
else
  SRC_P=$SRC
  worktrees=$(git -C "$DST" worktree list --porcelain | awk '/^worktree /{print substr($0,10)}' | tail -n +2)
fi

# Linked worktrees inside the folder moved along; repair needs their new paths.
repair=()
while IFS= read -r wt; do
  [[ -z "$wt" ]] && continue
  if [[ "$wt" == "$SRC_P"/* ]]; then wt="$DST${wt#"$SRC_P"}"; elif [[ "$wt" == "$SRC"/* ]]; then wt="$DST${wt#"$SRC"}"; fi
  if ((DRY)) || [[ -d "$wt" ]]; then repair+=("$wt"); fi
done <<<"$worktrees"
if ((DRY)); then echo "would: git -C $DST worktree repair ${repair[*]+"${repair[*]}"}"; else
  echo "+ git worktree repair (${#repair[@]} worktrees)"; git -C "$DST" worktree repair ${repair[@]+"${repair[@]}"}
fi

GIT_DIR_OF=$([[ -d "$DST" ]] && echo "$DST" || echo "$SRC")
url=$(git -C "$GIT_DIR_OF" remote get-url origin 2>/dev/null || true)
new_url=${url//hpmartini\/DevHub/hpmartini\/Orkumo}
if [[ "$new_url" != "$url" ]]; then run git -C "$GIT_DIR_OF" remote set-url origin "$new_url"; fi

old_key=$(key "$SRC")
new_key=$(key "$DST")
if [[ -d "$CLAUDE_PROJECTS" ]]; then
  # "--": worktree folders (/.claude/... -> --claude-...), not siblings like DevOrbitDashboard-foo
  for d in "$CLAUDE_PROJECTS/$old_key" "$CLAUDE_PROJECTS/$old_key"--*; do
    [[ -d "$d" ]] || continue
    target="$CLAUDE_PROJECTS/$new_key${d#"$CLAUDE_PROJECTS/$old_key"}"
    if [[ -e "$target" ]]; then echo "skip: $target exists, merge $d by hand" >&2; continue; fi
    run mv "$d" "$target"
  done
fi

if [[ -f "$MAPLE_REPOS" ]] && grep -q "\"$SRC\"" "$MAPLE_REPOS"; then
  if ((DRY)); then echo "would: replace $SRC with $DST in $MAPLE_REPOS"; else
    echo "+ $MAPLE_REPOS: $SRC -> $DST"
    SRC="$SRC" DST="$DST" perl -pi -e 's/\Q"$ENV{SRC}"\E/"$ENV{DST}"/g' "$MAPLE_REPOS"
  fi
fi

IFS=: read -r -a data_dirs <<<"$ORKUMO_DATA_DIRS"
if ((DRY)); then
  echo "would: node $NODE_SCRIPT $SRC $DST ${data_dirs[*]}"
  node "$HERE/remap-project-path.mjs" --dry-run "$SRC" "$DST" "${data_dirs[@]}"
else
  node "$NODE_SCRIPT" "$SRC" "$DST" "${data_dirs[@]}"
fi

echo "done. Open new Claude sessions from $DST."
