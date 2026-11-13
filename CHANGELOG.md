# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Orchestrators: mark any agent as orchestrator from its row menu (it gets a short briefing) or start one with "New orchestrator"; orchestrators get their own pinned group and badge in the rail in every grouping. They run in the workspace `<data>/orchestrator/` (AGENTS.md, Claude settings that block sub-agents and edits outside the workspace, `orkumo-orchestrator` skill for Claude Code and omp), refreshed at every server start; `NOTES.md` stays theirs
- `orkumo` CLI for orchestrators: `agents`, `show`, `send`, `start --project`, `stop`, `projects`, against the new `/api/orchestrator/*` routes and the existing dispatch, reply, pane message and stop routes; work goes to real agent sessions (background `claude --bg` jobs or agent panes), never sub-agents
- Projects section in settings: search, rename, disable (with undo), merge into another project, add own projects (git roots only, validated); disabled and merged projects in collapsible sections. The rail regroups live; a project group's menu has "Project settings…"
- macOS self-update without a Developer ID: Orkumo downloads the matching zip from GitHub Releases, checks its sha512 against the release's `latest-mac.yml` and swaps its own bundle by rename on "Restart to update" or quit, with backup and rollback (`electron/selfUpdate.js`). Updates run by themselves (check 5 s after start and every 6 h, background download, a small non-blocking banner with progress and "Restart to update"); the modal update dialogs are gone
- macOS app menu (About, Check for Updates…, Settings… `Cmd+,`) and Settings → Updates with version/channel, last check, Check now, status and an auto-update switch (`autoUpdate` setting)
- Chats mode lists your claude.ai and ChatGPT conversations in the left rail automatically, no export or import: the desktop app syncs them through the built-in browser's login (on opening, then every 5 minutes, only what changed), with status chips and a "Log in to ChatGPT/Claude" button; Today / Yesterday / This week / Older groups, search, provider filter, keyboard navigation; the reader renders answers as Markdown and opens a conversation on claude.ai / chatgpt.com. Login cookies and tokens stay in the Electron main process; the server only receives conversation data through a loopback-only ingest route. Importing a data export moved to the overflow menu (still the way in for the web version)
- Agent UI view: each turn's answer is one card (harness, model, steps, "Working…", result and duration, "Copy answer"); thinking and tool calls stay collapsible inside when steps are shown
- Agent UI view markdown: code blocks with language label and copy button, readable tables, task lists, heading spacing; file paths in inline code or links open in VS Code with Cmd/Ctrl-click (Shift: default app)
- Agent UI view: "Artifacts N" in the footer opens every file the agent created or edited plus omp's session documents (`local://`), grouped, with preview, Open in VS Code, Reveal in Finder and Copy path; updates live
- `POST /api/files/open` accepts `reveal: true` to always show the file in Finder
- Module fixture `test/fixtures/premium/with-slot`: a runnable example of a module UI in the `agents-rail` slot, next to the placeholder and the mode fixture (`docs/MODULES.md`, "Development").
- Chats mode (`/chats`, #280): import the official data exports of claude.ai and ChatGPT (unpacked folder) and read them in one local list: full-text search, filters for provider, project and period, topics, and "Continue in Orkumo" to carry a conversation into a new chat. Import, search and topics run locally, nothing is fetched from either provider; a continued conversation goes to the harness of the new chat
- Quick window (#251, desktop app): a system-wide shortcut (default `Alt+Shift+Space`, `ORKUMO_QUICK_SHORTCUT` overrides, empty turns it off) toggles a small always-on-top prompt field. Enter starts the default harness (Claude Code or Oh My Pi) in ~ as an agent pane of its own (`POST /api/agents/quick`) and shows its answer in the window; follow-ups are typed into that agent. Cmd+Enter ("In Orkumo öffnen") opens the same agent in the main window, Escape ends it. Other harnesses, or no server, hand the text to the composer in Orkumo
- Main agent (#252): a title bar button and the palette command "Main agent" open, in every view, a dialog on the background session named `main-orchestrator` (recent output, reply, attach). Keep-alive (on by default, switch in the dialog): a stopped main agent is restarted with `claude respawn`; Orkumo sends no prompt with it
- Fixed projects (#253): a project group kept via its menu ("Keep as fixed project") or added by directory ("Add fixed project…" in the command palette) stays in the rail's Project grouping without sessions; sessions of its worktrees land in it
- "Neues Issue": `#` in the empty title lists the repositories, typing filters, Enter picks one (#228)

### Removed

- Agents header: the "Close" button on other views (board, issues, code …); the activity bar switches views, so it only duplicated the Agents mode
- Monaco editor and its editor switcher in the Web IDE panel; VS Code (code-server) is the only integrated editor (#139)
- `/api/files/tree`, `/api/files/read`, `/api/files/write` (only used by Monaco)
- Agents view: the "Card details" setting (hover / click / always) and the row-menu entry "Keep details open" / "Hide details"; a stored value is dropped on load
- Chat drivers (`claude -p` stream-json, ACP for omp/opencode, `pi --mode rpc`, `codex app-server`) and the routes that started and fed them (`POST /api/agents/chat`, `…/message`, `…/permission`, `…/interrupt`, `GET /api/agents/chat`, `DELETE /api/agents/chat/:id`): the UI view no longer runs a process of its own

### Changed

- Code mode: the folder picker is a searchable popover instead of a select (Cmd/Ctrl+O): projects grouped by scan root with home-relative paths and duplicate names told apart by parent folder; per project its merged checkouts, the worktrees agents work in and the open one, the rest behind "N more worktrees" (click, → / ←; remembered); worktrees whose folder is gone are left out (`GET /api/apps` names them in `missingWorktrees`); search needs every word, lists a worktree only when it matches by itself and shows "N projects · M worktrees"; Recent (last 6 opened); agent folders outside every project under "Other folders"
- Project detection: only git repositories are projects; worktrees (also sibling `-wt` folders) belong to their main repository, package.json-only folders and parent folders are no longer projects. The rail's Project grouping uses the server's per-session `projectId`; sessions outside every project share one "No project" group instead of one group per folder
- The fixed-project picker offers only projects; context members that name no project are ignored (logged once at startup), not removed, so a repo that is temporarily missing returns to its contexts
- Local `electron:build*` builds are stamped `<version>-rc.<N>.dev.<sha>` with N the highest known rc (via `extraMetadata`, `package.json` untouched), so an installed local build is offered the next GitHub release and never an older one (a `-dev.<sha>` stamp ranked below every rc and was swapped back to the old rc.8)
- Agents workspace tiling works like Ghostty (#212): a pane dropped on the edge of another pane splits only that pane, every other pane keeps its place and size (before: a 2-column grid with empty cells). Saved workspaces are migrated
- A browser pane dragged onto the tab strip becomes its own tab and survives a reload (#212)
- Switched package manager to bun (`bun install` / `bun run`; node remains the runtime for server, electron and pty scripts)
- `pty-host` uses `bun.lock`; Docker images install with `--ignore-scripts` and build node-pty with the pinned node-gyp (bun's fallback to `node-gyp@latest` broke on Node 20)
- Agents view layout: the modes moved from the header into a vertical activity bar at the left edge (VS Code style) with the settings gear at its bottom; "New task", "Agent", "Chat" and "Issue" became one split button [New task | ⌄] next to the robot; the command palette button sits at the right edge of the title bar; grouping, sort, filters and search share one row above the agent list, the grouping shows only the current choice and lists the others on hover; text search and the PR / issue filter are one search button that opens its field on click or Cmd/Ctrl+K
- Releases: every merge to `main` builds and publishes a pre-release `vX.Y.Z-rc.N` on GitHub via Woodpecker (Linux and macOS installers with update metadata, GHCR images, release compose file); the Woodpecker config moved to `.woodpecker/`. Setup (token secret, trusted repo, macOS agent) in DESKTOP.md, "Releases"
- Agents view: a card's details (issues, PRs, servers) open only through the chevron at the card's left edge and push the cards below down; hovering, clicking or selecting a card no longer opens them
- Agents view: the UI (chat) view is only another view of the agent's terminal. Switching between "UI view" and "Terminal view" in the pane header keeps the one process running; no more "the session is closed and a new one opened". The UI view renders the agent's transcript (Claude Code, Oh My Pi, Pi) and types messages into its terminal; questions and permission prompts come from the terminal screen with answer buttons. "New chat" starts the same agent as "New agent", opened in the UI view; the setting "Open agents in" picks the view a pane opens in, also for background jobs. OpenCode and Codex open in the terminal (no transcript reader yet)
- Agents view: agents started in an Orkumo terminal (Claude Code started here, Oh My Pi, Pi, OpenCode, Codex) keep running when their pane or tab is closed, the page reloads, the Orkumo server restarts or the Electron app quits: each runs in its own small holder process, and opening it again (or the restarted server) reattaches to the same process with its recent output. "Stop" in the row menu ends it. Shell panes and `claude attach` panes are unchanged (a shell ends with its pane; a background job runs on anyway)
- Agents view: the switch "Interactive sessions" now hides terminal sessions of every harness that no Orkumo pane runs (started elsewhere, often by other agents, or ended), also Oh My Pi sessions; the agents of your panes stay listed
- Agents view: new agents default to Oh My Pi (setting "Default harness for new agents"; a stored choice wins), so New task / New agent / Chat and the board's "Agent starten" preselect it
- Agents view: collapse / expand all groups moved out of the grouping menu into two toggle buttons in the filter row: one folds all groups (projects), one opens or closes the details of all agent cards
- Terminal links: Cmd/Ctrl-click on a file path opens it in VS Code, in the window of the pane's project (git root of its directory) at the clicked line; Cmd/Ctrl+Shift-click keeps the old "default macOS app"; folders still open in Finder. Cmd/Ctrl+Shift-click on a URL (terminal or app link) always opens the system browser
- Agents list is event-driven instead of polled: the server watches the session stores (`~/.claude/jobs`, `~/.claude/sessions`, `~/.omp/agent/sessions`, `~/.omp/agent/terminal-sessions`, one `fs.watch` each) and runs `claude agents --json` only after a change (300 ms debounce, at most every 2.5 s) plus a 60 s reconcile, only while a client is subscribed (was: every 2.5 s). Session context (git, gh) refetches when a session's state or turn changes, and the server re-reads git/gh only for repos whose sessions changed (others every 5 min). All client polls (peek, chat, status line, board, issues, usage, servers panel, daemon status) pause while the page is hidden. Idle agents view: 441 → 13 processes/min

### Security

- The Electron renderer's `file://` origin (`Origin: null` / `file://`) no longer authorizes API, PTY WebSocket or module requests on its own: Electron main tags its main and quick window top-frame requests with a per-launch secret (`X-Orkumo-Renderer`), so sandboxed iframes and local files can no longer start agents, type into terminals or read chats
- Chat history reads (list, conversation, sync-state, import) are answered only to the desktop app, local requests without Origin and pages served from Orkumo's own or Vite's port, no longer to any loopback origin
- The API server listens on loopback only (it was on every interface without remote mode, so any device on the LAN could start agents and type into their terminals). Docker keeps every interface; `DEVORBIT_LISTEN_HOST` is the explicit opt-in for another address
- Text typed into an agent pane (`POST /api/agents/panes/:paneId/message`, `orkumo send`, quick window follow-ups) rejects control characters and drops them in `typeIntoPanePty`: an ESC ended the bracketed paste and sent raw keys (Claude Code's `!` bash mode, Shift+Tab permission mode). The quick window's start prompt follows `--` and must not start with `-`, so it can never become a Claude Code option such as `--settings`
- Orchestrators: the `orkumo` CLI, its config and wrapper moved out of the orchestrator workspace to `<data>/orchestrator-bin/` (read-only), so an orchestrator can no longer rewrite its own pre-approved CLI; the guard also blocks edits to the workspace's `.claude/`, `.omp/`, `AGENTS.md`, `CLAUDE.md` (Bash writes to them best effort), and the CLI sends the pairing token only to loopback API addresses

### Fixed

- Agents rail: an Oh My Pi session shows as working while its turn is open (read from the end of its session file), while one of its subagents works, or while its Orkumo pane prints. Before, it was working only for 15 s after a write, and a running session whose subagent file was open showed as completed. omp changes refresh without waiting for `claude agents --json`, and a failed `ps`/`lsof` keeps the last known running sessions
- Agents rail: Claude Code terminal sessions show working (busy) and needs input (waiting) in the rail, the Working filter and the summary instead of a static "interactive"; a background job that is done but busy again shows working
- UI view `/` picker: Oh My Pi views listed no commands at all (no `/goal`, no skills); they now get omp's terminal-only built-ins (`/goal`, `/plan`, `/new`, …) plus everything `omp --mode rpc` reports (skills, custom, extension and file commands), probed without a session file and cached for 5 minutes
- Claude's `/` picker and the dispatch input missed enabled plugin skills and commands (`plugin:name`), symlinked and claude.ai-synced skills, nested commands (`dir:name`), project skills above the cwd and interactive built-ins; they are listed now, `user-invocable: false` skills stay hidden
- Agents rail: clicking the card of an agent that runs in an open pane (Oh My Pi, a Claude terminal, a resumed session; its row id differs from the pane id) did not switch to that pane's tab; every kind of pane is now selected and focused
- Cmd+, (Ctrl+, off macOS) did not open the settings while the cursor was in a terminal, the UI view's composer or any text field; Cmd chords now work from every field, plain-key shortcuts still leave fields alone
- Agents view: a client whose SSE stream ended with both `close` and `error` was counted twice, so the session watcher stopped while another client still listened (that view got no more live updates)
- Agents rail: Oh My Pi sessions nobody ever prompted (an omp chat or `omp acp` opened and closed, a TUI quit right away) were listed as "omp <id>" cards with age 0s; finished sessions without a user message are no longer listed (running ones still are)
- Chat and peek: recent prompts were missing. A prompt typed while Claude Code works is stored as a queued-command attachment, not a user message, so the chat (resume history and live view of a running agent) never showed it; it now does, task notifications stay hidden. omp's replayed `<system-reminder>` notes no longer show as prompts, and the omp peek reads back past megabytes of tool output instead of only the newest 512 KB, which often held just the last prompt
- Composer images: large screenshots and photos failed with "413 Payload too large" (over 10 MB); images are now scaled down in the browser before upload (at most 2000 px, 3.75 MB, as Claude Code and omp do with a pasted image)
- Oh My Pi chats (and omp terminal panes) started in Orkumo showed only omp's built-in commands, none of the user's skills: omp loads Claude's user skills and plugins only on opt-in. Orkumo now starts omp with a `--config` overlay that opts in `~/.claude/skills` and the enabled Claude plugins (125 skills here, `/skill:<name>`), and the chat's `/` picker no longer cuts the list at 50 entries
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
