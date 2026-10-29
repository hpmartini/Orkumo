# CLAUDE.md

## Leitbild

DevOrbit ist Hapes komplette Arbeitsumgebung für agentische Entwicklung (ADE). Kernobjekt ist der Kontext Issue ↔ Agent ↔ Worktree/Branch ↔ PR ↔ Code; Modi (Überblick, Board, Agents, Code, Terminal) teilen eine Shell. Verbindlich: [docs/VISION.md](docs/VISION.md).

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

DevOrbit Dashboard is a React-based workspace for agentic development. It scans the directories configured in the admin panel as a project registry (projects open in Code mode, `/code?path=`); it no longer starts, stops or analyzes apps (issue #143).

The overview (`/dashboard`) shows:

- Agent situation (`components/AgentOverview.tsx`, derivation in `utils/agentOverview.ts`): running / needs input / working / done, lists "cache expires < 10 min" and "compaction needed"; each entry opens the agent in `/agents`
- Compact usage card linking to the usage page
- System Health: memory, CPU, top processes by CPU and RSS, top apps (`server/services/healthService.js`)

Usage page (`/usage`, `components/UsageView/`, `server/services/usageService.js`, route `/api/usage?days=1..90`):

- Tokens per day, model and provider (input, output, cache read, cache write) for Claude Code, each Codex account and MiniMax, read from local session logs (`~/.claude/projects`, `$CODEX_HOME/sessions`)
- Plan limits (5h / week): Codex from the newest `rate_limits` event; Claude from the statusline snapshot written by `scripts/claude-rate-limits-tap.sh`, fallback `~/.claude.json`; missing source shows "Limit unbekannt"
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
├── types.ts          # TypeScript types (AppConfig, AppStatus enum)
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
- **AI Integration**: @google/genai SDK with structured JSON responses via `responseSchema`

### AppStatus Flow

Applications transition through states: `STOPPED` -> `STARTING` -> `RUNNING` | `ANALYZING`

### Path Alias

The `@/` alias resolves to the project root (not `src/`), defined in both `tsconfig.json` and `vite.config.ts`.
