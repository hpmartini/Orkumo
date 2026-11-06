#!/usr/bin/env bash
# #200: stress the rail tests under CPU load. Exit 0 only if every run passes all EXPECTED tests.
# Usage: scripts/review/200.sh [rounds=20] [parallel=24]; LOAD=20 extra busy-loop burners (0 = none)
# On origin/main 2cbc524 (before the fix) `scripts/review/200.sh 2 24` gave 1 timeout in 48 runs.
set -euo pipefail
cd "$(dirname "$0")/../.."
ROUNDS=${1:-20}; PAR=${2:-24}; LOAD=${LOAD:-20}; EXPECTED=${EXPECTED:-35}
export NO_COLOR=1 FORCE_COLOR=0
OUT=$(mktemp -d); BURNERS=()
cleanup() { [ ${#BURNERS[@]} -eq 0 ] || { kill "${BURNERS[@]}"; wait "${BURNERS[@]}"; } 2>/dev/null || true; rm -rf "$OUT"; }
trap cleanup EXIT
for ((i = 0; i < LOAD; i++)); do yes >/dev/null & BURNERS+=($!); done
FILES="test/agentsViewRail.test.tsx test/railModes.test.tsx"
fails=0; timeouts=0
for r in $(seq 1 "$ROUNDS"); do
  RUNS=()
  for p in $(seq 1 "$PAR"); do bunx vitest run $FILES >"$OUT/$r-$p.log" 2>&1 & RUNS+=($!); done
  wait "${RUNS[@]}" || true
  for p in $(seq 1 "$PAR"); do
    log="$OUT/$r-$p.log"
    f=$(grep -Eo '[0-9]+ failed' "$log" | tail -1 | grep -Eo '[0-9]+' || echo 0)
    t=$(grep -c 'timed out in 5000ms' "$log" || true)
    if ! grep -Eq "Tests +$EXPECTED passed \($EXPECTED\)" "$log"; then
      echo "run $r/$p: not $EXPECTED/$EXPECTED passed"; grep -E 'FAIL |timed out|Tests ' "$log" | sort -u
      [ "$f" -gt 0 ] || f=1
    fi
    fails=$((fails + f)); timeouts=$((timeouts + t))
  done
  echo "round $r/$ROUNDS: failed tests so far $fails (timeouts $timeouts)"
done
echo "RESULT: $((ROUNDS * PAR)) runs x $EXPECTED tests, LOAD=$LOAD: $fails failed, $timeouts timeouts"
[ "$fails" -eq 0 ]
