# CLAUDE.md

## Leitbild

Orkumo ist Hapes komplette Arbeitsumgebung für agentische Entwicklung (ADE). Kernobjekt ist der Kontext Issue ↔ Agent ↔ Worktree/Branch ↔ PR ↔ Code; Modi (Überblick, Board, Agents, Code, Terminal) teilen eine Shell. Verbindlich: [docs/VISION.md](docs/VISION.md).

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Orkumo is a React-based workspace for agentic development. It scans the directories configured in the admin panel as a project registry (projects open in Code mode, `/code?path=`); it no longer starts, stops or analyzes apps (issue #143).

Activity bar (#184, `components/ModeSwitcher.tsx`): narrow vertical column at the left edge of the AgentsView, like VS Code: Agents · modes of loaded modules (e.g. Workflows, #165) · Board · Issues · Pull Requests · Code, settings gear at the bottom; the route is the state. The AgentsView header starts with the robot and the split button [New task | ⌄] (`components/AgentsView/NewTaskButton.tsx`: agent, chat, issue in the dropdown). The robot opens the context dashboard (`/dashboard?scope=context`), the rocket in the title bar the global one (`/dashboard`); the title bar's right edge opens the command palette (Cmd/Ctrl+P).

Rail filter row (`AgentFilterBar` in `components/AgentsView/AgentSummaryBar.tsx`): one line with the grouping (`GroupingPicker` in `ProjectsRail.tsx`, shows the current grouping, hover lists the others), sort, filter chips toggle, one search button (Cmd/Ctrl+K; in a terminal off macOS Ctrl+Shift+K) whose panel narrows the agents by text and lists the matching PRs and issues as link filters, and `FoldButtons` (`ProjectsRail.tsx`): toggles that collapse / expand all groups and all agent cards' details.

Terminal links (`AgentTerminal.tsx`): Cmd/Ctrl-click on a URL follows the link setting, Cmd/Ctrl+Shift-click opens the system browser (also for app anchors, `utils/links.ts`). Cmd/Ctrl-click on a file path opens it in VS Code in the window of the pane's project (`POST /api/files/open-in-editor`, git root above the pane's cwd, `-g file:line:col`); with Shift its default macOS app (`POST /api/files/open`); folders open in Finder.

Issues mode (`/issues`, `components/IssuesView/`, `server/services/issueListService.js`, route `GET /api/issues?context=&state=open|closed&refresh=1`): issues of the active context's repos (origin remotes of its apps, `appIds: null` = all, plus `repo:` board slices), read per repo via `gh api graphql`, so issues off the board are listed too (`onBoard` flag). Filters, grouping and sorting in the URL (`utils/issueQuery.ts`); a row opens the issue modal.

The dashboard (`/dashboard`, context variant filtered to the active context's project paths via `utils/projectScope.ts`) shows:

- Agent table (`components/AgentOverview.tsx`, `utils/agentTable.ts`, buckets from `utils/agentOverview.ts`): stat filters (running / needs input / working / done / cache expires < 10 min / compaction needed), search, grouping, actions jump / stop / restart / rename / delete with an in-app confirm dialog
- Sessions card (`components/UsageView/SessionsCard.tsx`, `GET /api/usage/sessions?days=`): last 7 days, tabs newest / most tokens / longest (first to last answer)
- Compact usage card linking to the usage page
- Tool versions (`server/services/toolVersionsService.js`, `GET /api/system/versions`): node, npm, git, docker; on the context dashboard also the Node version each project pins (.nvmrc, .node-version, engines.node)

Usage page (`/usage`, `components/UsageView/`, `server/services/usageService.js`, route `/api/usage?days=1..90`):

- Tokens per day, model and provider (input, output, cache read, cache write) for Claude Code, each Codex account and MiniMax, read from local session logs (`~/.claude/projects`, `$CODEX_HOME/sessions`)
- Plan limits (5h / week): Codex from the newest `rate_limits` event (also outside the window for idle accounts; a window past its reset counts as 0 %); Claude from a fresh statusline snapshot (`scripts/claude-rate-limits-tap.sh`), else live from the endpoint Claude Code's `/usage` calls with the subscription login (token from keychain / `.credentials.json`, server-side only, 5 min cache, no refresh), else `~/.claude.json`; missing source shows "Limit unbekannt", a source without a 5h window shows no 5h bar, snapshots older than 1 h are marked "veraltet" with their age; back button to the previous view
- `scripts/verify-usage.mjs --days 30` re-sums the same logs independently and diffs per day and provider

Further modes:

- Open new terminal tab with claude code
  - additional options: `-c` for continuing the last session, `--dangerously-skip-permissions`
- Claude Code Agents View (browser version of `claude agents`, route `/agents`):
  - `components/AgentsView/` - list, dispatch input, peek panel, attached sessions in tabs / tiled panes
  - `server/services/agentService.js` - wraps the `claude` CLI (`--bg`, `agents --json`, `logs`, `stop`, `respawn`, `rm`, `daemon`) and `~/.claude/jobs` state; routes under `/api/agents/*`
  - `utils/agentInput.ts` (dispatch syntax) and `utils/agentSessions.ts` (grouping) are pure and unit-tested
  - Interactive terminal sessions no Orkumo pane runs (no `paneId`; any harness: started elsewhere, often by another agent, or ended) are hidden in the rail unless the footer switch "Interactive sessions" is on (localStorage `devOrbitAgentInteractive`)
  - Claude app sessions (`kind: 'app'`, `server/services/appSessions.js`): interactive sessions whose `~/.claude/sessions/<pid>.json` has a `bridgeSessionId`; title, origin and status come from `api.anthropic.com/v1/sessions/<id>` with the subscription login (server-side, cached 60 s), they open on claude.ai
  - Oh My Pi sessions (`server/services/ompSessions.js`, harness #195): rows `omp-<uuid>` from `~/.omp/agent/sessions/*/*.jsonl` (running ones plus those written in the last 7 days), running = an `omp` process holds the file (lsof) or its terminal's `~/.omp/agent/terminal-sessions/<tty>` names it; `paneId` links a row to the Orkumo terminal pane that runs it; opening resumes with `omp -r <uuid>`. omp has no attach: a session running in another terminal is taken over (`POST /api/agents/omp-<uuid>/stop` SIGTERMs the process holding it, then the pane resumes it)
  - UI view (#189; `components/AgentsView/Chat/ChatPane.tsx`, client reducer `utils/chatEvents.ts`): every agent runs as its TUI in a terminal pane (PTY); the UI view is a second rendering of that pane, so switching terminal ↔ UI (pane header buttons "UI view" / "Terminal view", state per pane in `useAgentWorkspace` `views`, localStorage `devOrbitPaneViews`) never starts or stops a process. The terminal stays mounted (invisible) under the UI view; messages are pasted into its PTY (`typeIntoPane` in `AgentTerminal.tsx`), Stop sends Esc, prompts are read from its screen. `server/services/chatService.js` tails the transcript (`POST /api/agents/chat/view` with harness `claude`|`omp`|`pi`, sessionId, cwd; replay buffer, watchers, orphan timer stops an unwatched view), readers in `server/services/chatTranscripts.js` translate to Claude Code's stream-json event shapes: Claude `~/.claude/projects/<slug>/<uuid>.jsonl`, omp/pi session jsonl (`~/.omp|.pi/agent/sessions/<dir>/<ts>_<uuid>.jsonl`). A pane finds its session id from its args or the server row that names it (`paneId`, also for Claude terminals). "New chat" starts the same agent as "New agent", opened in the UI view; "Open agents in" (settings) picks the view a pane opens in. opencode and codex have no transcript reader: terminal only
  - A pane's xterm and PTY socket live in a registry in `AgentTerminal.tsx` (`paneTerminals`), not in the component: splitting / unsplitting remounts the pane and takes them back; an unmounted pane is released after 2 s. Without this a remount started a new PTY and ended omp and shell panes
  - Agent panes outlive pane, page, server and Electron: each agent PTY (`agent-<pane>-<ts>`, all but `claude attach`) runs in its own detached holder process (`server/services/ptyHolder.js`, client `heldPty.js`; Unix socket `<data>/pty/<hash>.sock`, newline-delimited JSON, output backlog). Closing a pane or tab or reloading only detaches; a new socket for the pane reattaches (`openAgentPty` in `ptyService.js`); a starting server reconnects to the holders still running (`restoreHeldPtys`, before it listens). Server rows name the pane (`paneId`), so the rail lists the detached agent, `openPlan` returns `reattach`, and after a reload `paneStandIns` in `AgentsView.tsx` rebuild the pane. Row menu "Stop" ends it (`POST /api/agents/panes/:paneId/stop`). Shell panes are PTYs of the server and end with their socket. Docker mode proxies to pty-host, which still ends a PTY with its socket. `scripts/bundle-server.js` bundles `ptyHolder.js` next to `index.js`
- Code mode (`/code`): terminals, Web-IDE (VS Code), browser preview

## Commands

```bash
# Install dependencies
bun install

# Run development server (port 3000)
bun run dev

# Build for production
bun run build

# Preview production build
bun run preview
```

## Environment Setup

Optional `DEVORBIT_CODEX_HOMES=Label=path,Label=path` lists the Codex accounts for `/usage`. For live Claude limits, wrap the statusline: `statusLine.command` = `bash <repo>/scripts/claude-rate-limits-tap.sh <existing statusline command>`.

## Architecture

This is a single-page React application with a flat file structure (no `src/` directory):

```
├── App.tsx           # Main component with all UI logic and state management
├── index.tsx         # React entry point
├── types.ts          # TypeScript types (AppConfig, AppType)
├── services/
│   └── api.ts           # REST client for the server
├── index.html        # HTML shell with Tailwind CDN config
└── vite.config.ts    # Vite config with @/ alias pointing to root
```

### Key Patterns

- **State Management**: All state lives in `App.tsx` using React hooks
- **Styling**: Tailwind CSS via CDN with custom colors (gray-750, gray-850, gray-950)
- **Charts**: Recharts for CPU/memory visualization
- **Icons**: lucide-react

### Path Alias

The `@/` alias resolves to the project root (not `src/`), defined in both `tsconfig.json` and `vite.config.ts`.
