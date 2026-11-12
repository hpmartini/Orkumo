# CLAUDE.md

Orkumo ist Hapes komplette Arbeitsumgebung für agentische Entwicklung (ADE). Kernobjekt: Kontext Issue ↔ Agent ↔ Worktree/Branch ↔ PR ↔ Code; Modi (Überblick, Board, Agents, Code, Terminal) teilen eine Shell. Verbindlich: `docs/VISION.md`.

- Gilt für alle Agent-Familien (`AGENTS.md` ist Symlink hierauf).
- Entwicklungsort: Dieses Repo ist der öffentliche Kern und Host. Pro-Features (mehrere Instanzen, mw-Workflows, native Clients) entstehen als Module und Apps im privaten Repo `hpmartini/DevHub-pro` (dort ADR-002), neue Issues standardmäßig dort; hierher kommen Kern, Modul-Vertrag (`docs/MODULES.md`) und Fixes.
- Before changing a mode (Agents, Chat, Issues, Dashboard, Usage) or usage setup: read `docs/agents/feature-map.md` (routes, services, data sources).
- Orkumo no longer starts, stops or analyzes apps (#143); project dirs are a registry only.
- Chat: `chatService.js` stays harness-neutral; protocol specifics live in one driver per protocol under `server/services/chatDrivers/`, emitting Claude Code stream-json shapes.
- Pane xterm + PTY socket live in the `paneTerminals` registry in `AgentTerminal.tsx`, not in the component: split/unsplit remounts must reclaim them, else a new PTY ends omp and shell panes.
