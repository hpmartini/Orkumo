# Feature-Karte (aus CLAUDE.md ausgelagert)

## Project Overview

Orkumo is a React-based workspace for agentic development. It scans the directories configured in the admin panel as a project registry (projects open in Code mode, `/code?path=`); it no longer starts, stops or analyzes apps (issue #143).

Activity bar (#184, `components/ModeSwitcher.tsx`): narrow vertical column at the left edge of the AgentsView, like VS Code: Agents · modes of loaded modules (e.g. Workflows, #165) · Board · Issues · Pull Requests · Code, settings gear at the bottom; the route is the state. The AgentsView header starts with the robot and the split button [New task | ⌄] (`components/AgentsView/NewTaskButton.tsx`: agent, chat, issue in the dropdown). The robot opens the context dashboard (`/dashboard?scope=context`), the rocket in the title bar the global one (`/dashboard`); the title bar's right edge opens the command palette (Cmd/Ctrl+P).

Rail filter row (`AgentFilterBar` in `components/AgentsView/AgentSummaryBar.tsx`): one line with the grouping (`GroupingPicker` in `ProjectsRail.tsx`, shows the current grouping, hover lists the others plus collapse / expand all), sort, filter chips toggle and one search button (Cmd/Ctrl+K; in a terminal off macOS Ctrl+Shift+K) whose panel narrows the agents by text and lists the matching PRs and issues as link filters.

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
  - Interactive terminal sessions are hidden in the rail unless the footer switch "Interactive sessions" is on (localStorage `devOrbitAgentInteractive`)
  - Claude app sessions (`kind: 'app'`, `server/services/appSessions.js`): interactive sessions whose `~/.claude/sessions/<pid>.json` has a `bridgeSessionId`; title, origin and status come from `api.anthropic.com/v1/sessions/<id>` with the subscription login (server-side, cached 60 s), they open on claude.ai
  - Oh My Pi sessions (`server/services/ompSessions.js`, harness #195): rows `omp-<uuid>` from `~/.omp/agent/sessions/*/*.jsonl` (running ones plus those written in the last 7 days), running = an `omp` process holds the file (lsof) or its terminal's `~/.omp/agent/terminal-sessions/<tty>` names it; `paneId` links a row to the Orkumo pane (terminal PTY or Chat pane) that runs it; opening resumes with `omp -r <uuid>`. omp has no attach: a session running in another terminal is taken over (`POST /api/agents/omp-<uuid>/stop` SIGTERMs the process holding it, then the pane resumes it)
  - Chat pane (UI mode, #189; `components/AgentsView/Chat/`, client reducer `utils/chatEvents.ts`) for every harness: `server/services/chatService.js` is harness-neutral (sessions, replay buffer, watchers, routes `/api/agents/chat/*`), one driver per protocol in `server/services/chatDrivers/` spawns the CLI and translates to Claude Code's stream-json event shapes: `claude.js` (`claude -p` stream-json), `acp.js` (omp and opencode via `acp`, Agent Client Protocol), `piRpc.js` (`pi --mode rpc`), `codex.js` (`codex app-server`). Model, permission mode, skip permissions and `/continue` are Claude-only; other harnesses use their own config. "Open as chat" hands an idle omp session (pane or other terminal, stopped first) to a chat; "Open in terminal" resumes a chat's session in the harness's TUI with the resume forms `config/harnesses.js` allows (`HARNESS_RESUME`: `omp -r`, `pi --session`, `opencode --session`, `codex resume`)
  - Status line and header of every chat: drivers report context fill and plan limits as `devorbit_usage` (ACP `usage_update`, pi `get_session_stats`, codex `thread/tokenUsage/updated` + `account/rateLimits/*`), kept per chat in `chatService` and served by `/api/agents/chat/:id/status` (`chatStatus.js`; Claude models without own limits show Claude's plan limits). PR links: Claude jobs report theirs, every other session and chat gets the open PRs of its branch (`withBranchPullRequests` in `utils/agentSessions.ts`, contexts include chats); board issues follow from those PRs
  - omp sessions Orkumo starts (chat and terminal panes) get the user's Claude skills: `server/services/ompSkills.js` writes an omp `--config` overlay (`skills.enableClaudeUser`, `enabledProviders` + `claude-plugins`, merged with the user's own providers), so omp loads `~/.claude/skills` and the enabled Claude plugins and lists them as `/skill:<name>`; the chat's `/` picker lists every command (no cap)
  - Card details (issues, PRs, servers): in the default mode they open only with the card's chevron button (or "Show details" in its menu) and stay open (`expandedSessions`); clicking a card only selects it
  - A pane's xterm and PTY socket live in a registry in `AgentTerminal.tsx` (`paneTerminals`), not in the component: splitting / unsplitting remounts the pane and takes them back; an unmounted pane is released after 2 s. Without this a remount started a new PTY and ended omp and shell panes
- Code mode (`/code`): terminals, Web-IDE (VS Code), browser preview

## Environment Setup

Optional `DEVORBIT_CODEX_HOMES=Label=path,Label=path` lists the Codex accounts for `/usage`. For live Claude limits, wrap the statusline: `statusLine.command` = `bash <repo>/scripts/claude-rate-limits-tap.sh <existing statusline command>`.
