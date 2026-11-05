# CLAUDE.md

## Leitbild

DevOrbit ist Hapes komplette Arbeitsumgebung für agentische Entwicklung (ADE). Kernobjekt ist der Kontext Issue ↔ Agent ↔ Worktree/Branch ↔ PR ↔ Code; Modi (Überblick, Board, Agents, Code, Terminal) teilen eine Shell. Verbindlich: [docs/VISION.md](docs/VISION.md).

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

DevOrbit Dashboard is a React-based workspace for agentic development. It scans the directories configured in the admin panel as a project registry (projects open in Code mode, `/code?path=`); it no longer starts, stops or analyzes apps (issue #143).

Mode bar (#184, `components/ModeSwitcher.tsx`) in the AgentsView header next to the robot: Agents · modes of loaded modules (e.g. Workflows, #165) · Board · Code; the route is the state. The robot opens the context dashboard (`/dashboard?scope=context`), the rocket in the title bar the global one (`/dashboard`).

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
