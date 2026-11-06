#!/usr/bin/env bash
# #126 e2e on Linux (AC-6): a real AppImage 1.0.0-rc.1 updates itself to rc.2 from a fake GitHub
# (download, sha512 check, replace, relaunch), inside Docker; a .deb-style install (no APPIMAGE) only notifies.
set -euo pipefail
unset ELECTRON_RUN_AS_NODE
here=$(cd "$(dirname "$0")" && pwd)
arch=${ARCH:-$(docker info --format '{{.Architecture}}' | sed 's/aarch64/arm64/; s/x86_64/x64/')}
work=${WORK:-$(mktemp -d)}
mkdir -p "$work"
trap '[ -n "${KEEP:-}" ] || rm -rf "$work"' EXIT

for v in 1.0.0-rc.1 1.0.0-rc.2; do
  [ -d "$work/build-$v" ] || "$here/build-fixture.sh" "$v" "$work/build-$v" --linux AppImage "--$arch" >"$work/build-$v.log" 2>&1
done
suffix=$([ "$arch" = x64 ] && echo linux || echo "linux-$arch")
rm -rf "$work/feed"
for v in 1.0.0-rc.1 1.0.0-rc.2; do
  mkdir -p "$work/feed/v$v"
  cp "$work/build-$v"/*.AppImage "$work/build-$v/latest-$suffix.yml" "$work/feed/v$v/"
  cp "$work/build-$v"/*.blockmap "$work/feed/v$v/" 2>/dev/null || true
done
cp "$here/fake-github.mjs" "$work/"
cp "$work/build-1.0.0-rc.1"/*.AppImage "$work/installed.AppImage"
platform=$([ "$arch" = x64 ] && echo linux/amd64 || echo linux/arm64)

docker run --rm --platform "$platform" -v "$work:/w" node:20-bookworm bash -euo pipefail -c '
  apt-get update -qq >/dev/null
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq xvfb xauth libnss3 libgtk-3-0 libgbm1 libasound2 libxss1 libxtst6 >/dev/null 2>&1
  cd /w && npm init -y >/dev/null && npm i -s semver@7 >/dev/null
  node fake-github.mjs feed 18126 > server.log 2>&1 &
  sleep 1
  chown -R node /w
  export ORKUMO_UPDATE_FEED=http://127.0.0.1:18126 APPIMAGE_EXTRACT_AND_RUN=1
  sha_before=$(sha256sum installed.AppImage | cut -c1-16)
  # AppImage: install mode; the relaunched rc.2 writes to the same log
  su node -c "ORKUMO_UPDATE_FEED=$ORKUMO_UPDATE_FEED APPIMAGE_EXTRACT_AND_RUN=1 ORKUMO_E2E_LOG=/w/appimage.log \
    xvfb-run -a /w/installed.AppImage" || true
  for _ in $(seq 60); do grep -q "version 1.0.0-rc.2" appimage.log 2>/dev/null && break; sleep 1; done
  sleep 3
  echo "sha before $sha_before after $(sha256sum installed.AppImage | cut -c1-16)"
  echo "rc.2 AppImage $(sha256sum feed/v1.0.0-rc.2/*.AppImage | cut -c1-16)"
  # .deb/.rpm: same app without APPIMAGE (extracted, run directly) -> notify only
  cp feed/v1.0.0-rc.1/*.AppImage deb.AppImage && chown node deb.AppImage
  su node -c "cd /tmp && /w/deb.AppImage --appimage-extract >/dev/null && \
    ORKUMO_UPDATE_FEED=$ORKUMO_UPDATE_FEED ORKUMO_E2E_LOG=/w/deb.log xvfb-run -a /tmp/squashfs-root/AppRun" || true
' | tee "$work/docker.out"

fail=0
check() { if grep -Eq -- "$2" "$work/$1"; then echo "  ok: $2"; else echo "  missing in $1: $2"; fail=1; fi; }
echo "--- appimage.log"; sed 's/^/    /' "$work/appimage.log"
check appimage.log 'mode=install'
check appimage.log 'update-available 1\.0\.0-rc\.2'
check appimage.log 'downloaded'
check appimage.log 'version 1\.0\.0-rc\.2'
after=$(sed -n 's/^sha before .* after //p' "$work/docker.out")
want=$(sed -n 's/^rc.2 AppImage //p' "$work/docker.out")
if [ -n "$after" ] && [ "$after" = "$want" ]; then echo "  ok: installed.AppImage replaced by rc.2 ($after)"; else echo "  installed.AppImage not rc.2"; fail=1; fi
echo "--- deb.log"; sed 's/^/    /' "$work/deb.log"
check deb.log 'mode=notify'
check deb.log 'openExternal https://github\.com/hpmartini/Orkumo/releases/tag/v1\.0\.0-rc\.2'
if [ $fail = 0 ]; then echo "PASS linux"; else echo "FAIL linux"; fi
exit $fail
