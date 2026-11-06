#!/usr/bin/env bash
# Review for #88 (review follow-ups from #82). Run from the PR worktree:
#   scripts/review/88.sh          tests + throwaway server with a fake gh (no GitHub writes)
#   scripts/review/88.sh --live   additionally against GitHub/MACC: times a cold-cache create,
#                                 edits and closes a "[test #88]" issue in hpmartini/Orkumo,
#                                 checks a foreign repo gets 403
set -euo pipefail
cd "$(dirname "$0")/../.."
ROOT=$PWD
LIVE=${1:-}

TMP=$(mktemp -d)
TMP=$(cd "$TMP" && pwd -P) # /private/var: /var is not a scannable project directory
PID=
cleanup() {
  [ -n "$PID" ] && kill "$PID" 2>/dev/null || true
  rm -rf "$TMP"
}
trap cleanup EXIT

[ -d node_modules ] || bun install >/dev/null

echo "== typecheck"
bunx tsc --noEmit
echo "== board tests (service, routes via real server + fake gh)"
bunx vitest run test/boardService.test.js test/boardReviewFollowups.test.js test/boardWriteRoutes.test.js
echo "== railPreferences 20x"
for i in $(seq 20); do bunx vitest run test/railPreferences.test.tsx >/dev/null 2>&1 || { echo "run $i failed"; exit 1; }; done
echo "railPreferences: 20/20 green"

PORT=$(node -e 'const s=require("net").createServer().listen(0,()=>{console.log(s.address().port);s.close()})')
BASE=http://127.0.0.1:$PORT
GH_PATH=$PATH
[ "$LIVE" = "--live" ] || GH_PATH="$ROOT/test/fixtures/fake-gh:$PATH"
PATH=$GH_PATH FAKE_GH_LOG=$TMP/gh.log SERVER_PORT=$PORT DEVORBIT_DATA_PATH=$TMP \
  DEVHUB_PREMIUM_DIR=/nonexistent-orkumo-modules node server/index.js >"$TMP/server.log" 2>&1 &
PID=$!
for _ in $(seq 120); do curl -sf "$BASE/api/board/settings" >/dev/null && break; sleep 0.5; done
j() { curl -s -w '\nHTTP %{http_code} in %{time_total}s\n' -H 'Content-Type: application/json' "$@"; }

if [ "$LIVE" = "--live" ]; then
  # Board source stays the default (MACC); the main checkout counts as local clone of hpmartini/Orkumo
  MAIN=$(git worktree list --porcelain | awk '/^worktree /{print $2; exit}')
  j -X POST "$BASE/api/config/directories" -d "{\"path\":\"$MAIN\"}" >/dev/null
  echo "== AC-4 cold-cache create in hpmartini/Orkumo (server just started, board not loaded)"
  OUT=$(j -X POST "$BASE/api/board/issues" -d '{"repo":"hpmartini/Orkumo","title":"[test #88] cold-cache create","body":"Test from scripts/review/88.sh, closed right away.","labels":[]}')
  echo "$OUT" | tail -1
  echo "$OUT" | tail -1 | grep -q 'HTTP 201' || { echo "$OUT" | head -1; exit 1; }
  ITEM=$(echo "$OUT" | head -1 | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);console.log(j.itemId+" "+j.number)})')
  read -r ITEM_ID NUMBER <<<"$ITEM"
  echo "created #$NUMBER ($ITEM_ID)"
  echo "== AC-12 edit: title + labels, then close as not planned"
  j -X PATCH "$BASE/api/board/items/$ITEM_ID/issue" -d '{"title":"[test #88] edited","labels":["bug"]}' | tail -1
  j -X PATCH "$BASE/api/board/items/$ITEM_ID/issue" -d '{"state":"CLOSED","stateReason":"NOT_PLANNED"}' | tail -1
  gh issue view "$NUMBER" -R hpmartini/Orkumo --json title,state,stateReason,labels,url
  echo "== full board load for comparison (what create waited for before)"
  j "$BASE/api/board/items?refresh=1" -o /dev/null | tail -1
  echo "== AC-7 foreign repo"
  j -X POST "$BASE/api/board/issues" -d '{"repo":"octocat/Hello-World","title":"must not exist"}'
  exit 0
fi

echo "== AC-7 foreign repo (fake gh)"
j -X POST "$BASE/api/board/issues" -d '{"repo":"o/foreign","title":"x"}'
echo
echo "Throwaway server (fake gh, board o/1): $BASE   login: none (local)"
echo "API: curl $BASE/api/board/items   Stop with Ctrl-C."
wait "$PID"
