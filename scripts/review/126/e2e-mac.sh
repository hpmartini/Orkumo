#!/usr/bin/env bash
# #126 e2e on macOS: real packaged (ad-hoc signed) fixture apps against a fake GitHub, through
# electron/updater.js's feed check and the bundle swap (electron/selfUpdate.js). Covers AC-1, AC-4, AC-5,
# AC-7 and the self-update rc.1 -> rc.2 by swap + relaunch.
set -euo pipefail
unset ELECTRON_RUN_AS_NODE # set inside Orkumo/Claude shells; would start the fixture as plain node
here=$(cd "$(dirname "$0")" && pwd)
arch=$(uname -m | sed 's/x86_64/x64/')
work=${WORK:-$(mktemp -d)}
mkdir -p "$work"
port=${PORT:-18126}
pids=()
cleanup() {
  for p in "${pids[@]+"${pids[@]}"}"; do kill "$p" 2>/dev/null || true; done
  [ -n "${KEEP:-}" ] || rm -rf "$work"
}
trap cleanup EXIT
fail=0

build() { # <version> [extra flags] -> app dir
  local v=$1 out="$work/build-$1${2:+-dir}"
  if [ ! -d "$out" ]; then
    if [ -n "${2:-}" ]; then
      "$here/build-fixture.sh" "$v" "$out" --mac --dir "--$arch" >"$out.log" 2>&1
    else
      "$here/build-fixture.sh" "$v" "$out" --mac zip "--$arch" >"$out.log" 2>&1
      (cd "$out" && ditto -x -k ./*-mac.zip unzipped)
    fi
  fi
  if [ -n "${2:-}" ]; then echo "$out/mac-$arch/OrkumoUpdateFixture.app"; else echo "$out/unzipped/OrkumoUpdateFixture.app"; fi
}

release() { # <feed-root> <version>: a release with a real latest-mac.yml written by electron-builder for that version
  mkdir -p "$1/v$2"
  sed -e "s/1\.0\.0-rc\.1/$2/g" "$work/build-1.0.0-rc.1/latest-mac.yml" >"$1/v$2/latest-mac.yml"
}

run() { # <name> <app> <feed-url> <expect-regex>... ; prefix a regex with ! for "must not appear"
  local name=$1 app=$2 feed=$3 log="$work/$1.log"
  shift 3
  : >"$log"
  ORKUMO_UPDATE_FEED=$feed ORKUMO_E2E_LOG=$log "$app/Contents/MacOS/OrkumoUpdateFixture" >/dev/null 2>&1 &
  local app_pid=$! waited=0
  while kill -0 "$app_pid" 2>/dev/null; do
    # the windowless fixture sometimes lingers after check-done (seen under load); the check itself is finished then
    if grep -q '^check-done' "$log" && [ $waited -ge 15 ]; then kill "$app_pid"; echo "exit-slow (killed after check-done)" >>"$log"; break; fi
    if [ $waited -ge 120 ]; then kill "$app_pid"; echo "timeout" >>"$log"; break; fi
    sleep 1
    waited=$((waited + 1))
  done
  wait "$app_pid" 2>/dev/null || true
  local ok=1
  for re in "$@"; do
    if [[ $re == !* ]]; then
      if grep -Eq -- "${re#!}" "$log"; then ok=0; echo "  unexpected: ${re#!}"; fi
    elif ! grep -Eq -- "$re" "$log"; then
      ok=0
      echo "  missing: $re"
    fi
  done
  if [ $ok = 1 ]; then echo "PASS $name"; else echo "FAIL $name"; fail=1; fi
  sed 's/^/    /' "$log"
}

serve() { # <feed-root>
  pkill -f "fake-github.mjs .* $port" 2>/dev/null || true
  node "$here/fake-github.mjs" "$1" "$port" >"$1.server.log" 2>&1 &
  pids+=($!)
  for _ in $(seq 50); do curl -s "http://127.0.0.1:$port/" >/dev/null && return; sleep 0.1; done
}

echo "building fixtures ($arch) in $work"
rc1=$(build 1.0.0-rc.1)
rc2=$(build 1.0.0-rc.2)
rc9=$(build 1.0.0-rc.9)
rc1dir=$(build 1.0.0-rc.1 dir)
feed="http://127.0.0.1:$port"

# AC-4: rc.1 -> rc.2 in channel rc; ad-hoc build without ORKUMO_E2E_SWAP = notify mode (AC-7)
f="$work/feed-a"; release "$f" 1.0.0-rc.1; release "$f" 1.0.0-rc.2; serve "$f"
run ac4-rc1-to-rc2 "$rc1" "$feed" 'mode=notify' 'update-available 1\.0\.0-rc\.2' \
  'status available 1\.0\.0-rc\.2 https://github\.com/hpmartini/Orkumo/releases/tag/v1\.0\.0-rc\.2' '!Squirrel|ERR_' '!status error' '!timeout'

# AC-4: rc.10 sorts after rc.9
f="$work/feed-b"; release "$f" 1.0.0-rc.9; release "$f" 1.0.0-rc.10; serve "$f"
run ac4-rc9-to-rc10 "$rc9" "$feed" 'update-available 1\.0\.0-rc\.10'

# AC-5: rc.2 -> final 1.0.0
f="$work/feed-c"; release "$f" 1.0.0-rc.1; release "$f" 1.0.0-rc.2; release "$f" 1.0.0; serve "$f"
run ac5-rc2-to-final "$rc2" "$feed" 'update-available 1\.0\.0$' 'status available 1\.0\.0 .*/tag/v1\.0\.0$'

# no newer release, no final at all
f="$work/feed-d"; release "$f" 1.0.0-rc.2; serve "$f"
run no-update "$rc2" "$feed" 'no newer release' 'check-done state=none' '!status error'

# AC-1: unreachable feed -> an error status for the UI, never a dialog
run ac1-unreachable "$rc1" "http://127.0.0.1:1" 'Update failed' 'check-done state=error'

# AC-7: `--dir` build has no app-update.yml -> notify mode, still finds the update
f="$work/feed-a"; serve "$f"
run ac7-dir-build "$rc1dir" "$feed" 'mode=notify' 'update-available 1\.0\.0-rc\.2' 'status available'

# swap (ad-hoc, no Developer ID): rc.1 in a writable "Applications" folder downloads the real rc.2 zip, checks
# its sha512 against rc.2's latest-mac.yml, swaps the bundle by rename and relaunches as rc.2 via `open`.
# The relaunched app has no shell env: both read e2e-env.json next to the bundle (fixture-main.mjs).
f="$work/feed-e"; rm -rf "$f"; release "$f" 1.0.0-rc.1; mkdir -p "$f/v1.0.0-rc.2"
cp "$work/build-1.0.0-rc.2/latest-mac.yml" "$work/build-1.0.0-rc.2/"*-mac.zip "$f/v1.0.0-rc.2/"
serve "$f"
apps="$work/Applications"; rm -rf "$apps" "$work/swap-data"; mkdir -p "$apps"
ditto "$rc1" "$apps/OrkumoUpdateFixture.app"
log="$work/swap.log"; : >"$log"
cat >"$apps/e2e-env.json" <<JSON
{ "ORKUMO_UPDATE_FEED": "$feed", "ORKUMO_E2E_LOG": "$log", "ORKUMO_E2E_SWAP": "1", "ORKUMO_E2E_DATA": "$work/swap-data" }
JSON
"$apps/OrkumoUpdateFixture.app/Contents/MacOS/OrkumoUpdateFixture" >/dev/null 2>&1 &
pids+=($!)
for _ in $(seq 120); do grep -q '^version 1\.0\.0-rc\.2' "$log" && grep -q 'check-done' <(sed -n '/^version 1\.0\.0-rc\.2/,$p' "$log") && break; sleep 1; done
ok=1
for re in 'mode=swap' 'status downloading 1\.0\.0-rc\.2' 'status ready 1\.0\.0-rc\.2' '^installing' '^version 1\.0\.0-rc\.2' 'check-done state=none'; do
  grep -Eq -- "$re" "$log" || { ok=0; echo "  missing: $re"; }
done
installed=$(/usr/bin/plutil -extract CFBundleShortVersionString raw -o - "$apps/OrkumoUpdateFixture.app/Contents/Info.plist")
[ "$installed" = 1.0.0-rc.2 ] || { ok=0; echo "  installed bundle is $installed"; }
leftovers=$(find "$apps" -maxdepth 1 -name '.*update-*')
[ -z "$leftovers" ] || { ok=0; echo "  leftovers: $leftovers"; }
grep -q 'updated' "$work/swap-data/updates/swap.log" 2>/dev/null || { ok=0; echo "  swap.log: $(cat "$work/swap-data/updates/swap.log" 2>/dev/null)"; }
if [ $ok = 1 ]; then echo "PASS swap-rc1-to-rc2"; else echo "FAIL swap-rc1-to-rc2"; fail=1; fi
sed 's/^/    /' "$log"

exit $fail
