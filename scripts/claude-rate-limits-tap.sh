#!/usr/bin/env bash
# Claude Code statusline wrapper: snapshots .rate_limits for DevOrbit, then runs the real statusline.
# Usage (settings.json statusLine.command): bash scripts/claude-rate-limits-tap.sh <real statusline command...>
# Never fails the statusline: every snapshot error is swallowed.

input=$(cat)

{
  dir="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
  target="$dir/devorbit-rate-limits.json"
  if printf '%s' "$input" | jq -e '.rate_limits | type == "object"' >/dev/null 2>&1; then
    tmp=$(mktemp "$target.XXXXXX") &&
      printf '%s' "$input" |
      jq -c --argjson now "$(($(date +%s) * 1000))" '{capturedAt: $now, rate_limits: .rate_limits}' >"$tmp" &&
      mv -f "$tmp" "$target" || rm -f "$tmp"
  fi
} >/dev/null 2>&1

[ $# -eq 0 ] && exit 0
printf '%s' "$input" | "$@"
