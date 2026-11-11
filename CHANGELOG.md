# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Fixed projects (#253): a project group kept via its menu ("Keep as fixed project") or added by directory ("Add fixed project…" in the command palette) stays in the rail's Project grouping without sessions; sessions of its worktrees land in it

### Removed

- Monaco editor and its editor switcher in the Web IDE panel; VS Code (code-server) is the only integrated editor (#139)
- `/api/files/tree`, `/api/files/read`, `/api/files/write` (only used by Monaco)

### Changed

- Switched package manager to bun (`bun install` / `bun run`; node remains the runtime for server, electron and pty scripts)
- `pty-host` uses `bun.lock`; Docker images install with `--ignore-scripts` and build node-pty with the pinned node-gyp (bun's fallback to `node-gyp@latest` broke on Node 20)
- Agents view layout: the modes moved from the header into a vertical activity bar at the left edge (VS Code style) with the settings gear at its bottom; "New task", "Agent", "Chat" and "Issue" became one split button [New task | ⌄] next to the robot; the command palette button sits at the right edge of the title bar; grouping, sort, filters and search share one row above the agent list, the grouping shows only the current choice and lists the others on hover (with collapse / expand all); text search and the PR / issue filter are one search button that opens its field on click or Cmd/Ctrl+K
- Releases: every merge to `main` builds and publishes a pre-release `vX.Y.Z-rc.N` on GitHub via Woodpecker (Linux and macOS installers with update metadata, GHCR images, release compose file); the Woodpecker config moved to `.woodpecker/`. Setup (token secret, trusted repo, macOS agent) in DESKTOP.md, "Releases"
- Agent cards: clicking a card only selects it; its details (issues, PRs, servers) open and close with the chevron button on the card (default "With the card's details button"), and stay open until closed

### Fixed

- Agents rail: Oh My Pi sessions nobody ever prompted (an omp chat or `omp acp` opened and closed, a TUI quit right away) were listed as "omp <id>" cards with age 0s; finished sessions without a user message are no longer listed (running ones still are)
- Chat and peek: recent prompts were missing. A prompt typed while Claude Code works is stored as a queued-command attachment, not a user message, so the chat (resume history and live view of a running agent) never showed it; it now does, task notifications stay hidden. omp's replayed `<system-reminder>` notes no longer show as prompts, and the omp peek reads back past megabytes of tool output instead of only the newest 512 KB, which often held just the last prompt
- Chat panes (every harness): messages with images failed with "413 Payload too large" for large screenshots and photos (over 10 MB), and the agent only got the file path, which it first had to open with a tool. Images are now scaled down in the browser before upload (at most 2000 px, 3.75 MB, as Claude Code and omp do with a pasted image) and reach the harness as image content: Claude Code as image blocks, omp/OpenCode as ACP image blocks, Pi as `images`, Codex as `localImage`
- Oh My Pi chats (and omp terminal panes) started in Orkumo showed only omp's built-in commands, none of the user's skills: omp loads Claude's user skills and plugins only on opt-in. Orkumo now starts omp with a `--config` overlay that opts in `~/.claude/skills` and the enabled Claude plugins (125 skills here, `/skill:<name>`), and the chat's `/` picker no longer cuts the list at 50 entries
- Agents view: "Open as chat" on an Oh My Pi terminal pane asked to take over the session ("Übernimmt Session") although the pane itself runs it; switching the view now goes straight to the chat. The dialog stays for an omp process running in a terminal outside Orkumo
- Agents panel and dashboard: Oh My Pi sessions can be stopped and deleted. Stop only closed a pane with the row's id, which never matched a session started via New task (`interactive-…` pane) or running in another terminal; it now ends the omp process on the server and closes the pane that ran it. Delete (was disabled) removes the session file, its artifacts folder and `.bak` copies like omp's own picker, after ending a running process
- Desktop app: terminals failed with "WebSocket connection error" since #220; the PTY upgrade check refused the packaged renderer's `Origin: file://` (it only accepted `null`, what fetch sends). `file://` now passes inside Electron like `null`
- Desktop app: Oh My Pi (and other TUIs that query terminal modes: opencode, vim) showed only the `# omp …` header line and never rendered. esbuild's minifier (target below es2021) broke xterm 6's pre-minified `requestMode`, the first DECRQM query threw and stopped the terminal's parser for good (xtermjs/xterm.js#5800, evanw/esbuild#4508). The frontend now builds with `target: 'es2021'`; the dev server was never affected
- Agents view: splitting a tab or undoing a split restarted every terminal in it, which ended Oh My Pi and shell panes (their process lives only in the PTY) and restarted `claude attach`. A pane's terminal and PTY connection now survive the remount; closing a pane still ends them
- Desktop app: the orphan-server Stop (#243) was refused as cross-origin, the packaged renderer's POST carries no Origin and is marked `Sec-Fetch-Site: cross-site`; inside Electron that marker alone no longer refuses a request

### Added

- Chat panes of every harness show context fill and plan limits in the status line (omp and OpenCode via ACP usage updates, Pi via its session stats, Codex via its token usage and rate limits; Claude models in omp/Pi show Claude's plan limits), and linked PRs, board issues and servers in the header like terminal panes
- PR links (and the board issues behind them) for every session, not only Claude Code jobs: omp, other harnesses and chats get the open PRs of their current branch, on the card, in the terminal pane header and in the chat header
- Chat pane (UI mode) for every harness, not only Claude Code: Oh My Pi and OpenCode via ACP, Pi via its RPC mode, Codex via `codex app-server`. Pick the harness in "New chat"; idle omp sessions open as chat ("Open as chat", or by default with "Open idle agents as chat"), and "Open in terminal" continues any chat in its harness's TUI (`omp -r`, `pi --session`, `opencode --session`, `codex resume`)
- Agents servers panel: section "Verwaist" lists listening servers of finished worktrees and jobs (`GET /api/agents/servers/orphans`) with a confirmed Stop (`POST /api/agents/servers/:pid/stop`, orphan pids only); a server now belongs to a session only via its process ancestry or the session's own dir without nested `.claude/worktrees/*` and `.claude/jobs/*` (#243)
- Issues mode (`/issues`, mode bar after Board): filterable list of the GitHub issues of the active context's repos, read straight from the repos so issues off the board appear too ("Board" badge marks the rest). Search, repo / label / assignee / milestone / author / board filters, open/closed, grouping and sorting in the URL; a row opens the issue modal (`GET /api/issues?context=&state=&refresh=1`)
- Agents rail: switch "Interactive sessions" in the rail footer (and palette command) shows terminal sessions started outside Orkumo; hidden by default, the choice is remembered, the switch counts the hidden ones
- Sessions started in the Claude app (iOS, Android, web) and running on this machine via Remote Control show as such: own group "Claude App", claude.ai's title instead of `claude-<xx>` (first prompt as fallback), origin badge (iOS / Android), state and status line from claude.ai, peek shows the transcript; opening one goes to its claude.ai page instead of forking it with `--resume`
- Oh My Pi sessions in the agents view (#195): listed from omp's own session store (`~/.omp/agent/sessions`, what `omp -r` shows) instead of only while their pane is open, so they survive reloads and sessions started in any terminal show up too. Title from omp, running/working/idle via the omp process holding the session, peek shows the transcript; opening one focuses the pane that runs it or resumes it with `omp -r <id>`. omp has no attach, so a session running in another terminal is taken over: after a confirm ("Übernimmt Session", warns when it is mid-turn) Orkumo ends that omp process (SIGTERM via `POST /api/agents/omp-<id>/stop`, only the process holding the session) and resumes it in a pane. The harness policy allows `omp -r <session uuid>`

- **Claude Code Agents View**: browser counterpart of `claude agents` at `/agents` (sidebar entry, shortcut `a`)
  - Session list grouped by state or directory, peek panel with reply / numbered choices / suggested reply
  - Dispatch input with the TUI syntax (`@agent`, `@repo`, `/resume`, `/model`, `/effort`, `! command`, `#PR`, filters)
  - Attach sessions in tabs or tiled (columns / rows / grid) via `claude attach`
  - Pin, rename, reorder, stop, delete (with `claude rm` force hints), respawn, supervisor controls
  - Dispatch defaults for every `claude agents` flag, `--cwd` scope, notifications
  - Directory picker for new sessions: collapse/expand parent directories one by one or all at once; collapsed state is remembered, filtering shows every match
  - New API under `/api/agents/*` and `/api/settings/agent-view`, backed by `server/services/agentService.js`
- **code-server Integration**: VS Code in browser alongside Monaco Editor
  - Toggle between Monaco (lightweight) and VS Code (full IDE) modes
  - Configurable via `VITE_CODE_SERVER_URL` environment variable
  - Configurable iframe timeout via `VITE_CODE_SERVER_TIMEOUT` (default: 15 seconds)
  - Resource limits to prevent excessive consumption (2 CPU cores, 2GB RAM max)
  - Health check for code-server container
  - Comprehensive security documentation for HTTPS setup

- **Security Enhancements**:
  - Path traversal validation for directory access
  - Separate sudo password option for code-server (`CODE_SERVER_SUDO_PASSWORD`)
  - Enhanced iframe sandbox security (removed `allow-same-origin` flag)
  - Password security requirements and documentation

- **Error Handling**:
  - Error boundary component (`WebIDEErrorBoundary`) for crash protection
  - 15-second timeout detection for iframe loading failures
  - Retry functionality with proper iframe reload

- **Accessibility**:
  - ARIA labels for all interactive elements
  - Proper roles for button groups
  - Screen reader support for editor type switcher

- **Developer Experience**:
  - DEV-only console logging to reduce production noise
  - iframe cleanup when switching back to Monaco
  - Memoized functions and values for better performance

### Changed

- **BREAKING**: Docker volume mounts changed from hardcoded `/Users/hape/` to `${HOME}/` variable
  - Migration required: Update your `.env` file or docker-compose overrides
  - API service: `/Users/hape/Projects` → `${HOME}/Projects`
  - API service: `/Users/hape/PROJECTS` → `${HOME}/PROJECTS`
  - code-server: Consistent mount paths with API service
  - **Action Required**: Restart containers after pulling this update

### Security

- **CRITICAL**: `CODE_SERVER_PASSWORD` must be set - container won't start without it
- Removed hardcoded default password from docker-compose.yml
- iframe sandbox now uses stricter isolation (no `allow-same-origin`)
- Path validation prevents directory traversal attacks

### Fixed

- Terminals stay in color when Orkumo was started from an agent or CI shell: the PTY no longer inherits `NO_COLOR`, `FORCE_COLOR` or `CI` from the server's launcher
- Agents panel: a `hover` card-details setting saved before #181 (the old default) migrates once to `click`; "Keep details open" only shows in hover mode (#242)
- Path mapping now correctly handles nested `Projects` folders
- iframe error detection with timeout fallback (onError doesn't reliably fire)
- Retry button now properly reloads iframe
- Console logs only appear in development mode

### Documentation

- Complete setup guide with security best practices
- HTTPS configuration options (Caddy, Nginx, SSH tunnel, Cloudflare)
- CORS documentation for cross-origin scenarios
- Troubleshooting guide for common issues
- Migration guide for volume mount changes

## [0.1.0] - Initial Release

### Added

- DevOrbit Dashboard - Developer application monitoring
- Monaco Editor integration
- Terminal panels with PTY support
- Browser preview panel
- Docker support
