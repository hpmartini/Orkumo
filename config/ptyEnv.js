/**
 * Environment for an Orkumo PTY. The server inherits the env of whatever started it; launched
 * from a terminal or an agent's shell, that env describes that launcher, not the xterm.js pane:
 *
 * - `NO_COLOR`, `FORCE_COLOR=0`, `CI` from agent shells would render every pane monochrome (#257)
 * - `TERM_PROGRAM=ghostty`, `GHOSTTY_*`, `TERMINFO`, ... make TUIs (omp, ...) use that emulator's
 *   features: Kitty graphics show as rows of placeholder boxes, glyph protocols go unanswered
 * - `PI_SESSION_*` / `PI_TOOL_CALL_ID` mark the omp session the server was started from
 *
 * Shared by the API (`ptyService.js`) and pty-host (Docker proxy).
 */
const DROP = new Set([
  'NO_COLOR',
  'FORCE_COLOR',
  'CI',
  'TERM_PROGRAM',
  'TERM_PROGRAM_VERSION',
  'TERM_SESSION_ID',
  'TERMINAL_EMULATOR',
  'TERMINFO',
  'TERMINFO_DIRS',
  'LC_TERMINAL',
  'LC_TERMINAL_VERSION',
  'COLORFGBG',
  'VTE_VERSION',
  'WT_SESSION',
  'WT_PROFILE_ID',
  'TMUX',
  'TMUX_PANE',
  'STY',
  'PI_SESSION_ID',
  'PI_SESSION_FILE',
  'PI_TOOL_CALL_ID',
]);
const DROP_PREFIXES = [
  'GHOSTTY_',
  'KITTY_',
  'WEZTERM_',
  'ITERM_',
  'ALACRITTY_',
  'KONSOLE_',
  'ZELLIJ',
];

/** `env` without the launcher's terminal identity; TERM/COLORTERM are the caller's to set */
export function ptyBaseEnv(env = process.env) {
  return Object.fromEntries(
    Object.entries(env).filter(
      ([key]) => !DROP.has(key) && !DROP_PREFIXES.some((prefix) => key.startsWith(prefix))
    )
  );
}
