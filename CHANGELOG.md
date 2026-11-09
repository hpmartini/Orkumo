# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Removed

- Monaco editor and its editor switcher in the Web IDE panel; VS Code (code-server) is the only integrated editor (#139)
- `/api/files/tree`, `/api/files/read`, `/api/files/write` (only used by Monaco)

### Changed

- Switched package manager to bun (`bun install` / `bun run`; node remains the runtime for server, electron and pty scripts)
- `pty-host` uses `bun.lock`; Docker images install with `--ignore-scripts` and build node-pty with the pinned node-gyp (bun's fallback to `node-gyp@latest` broke on Node 20)

### Added

- Agents servers panel: section "Verwaist" lists listening servers of finished worktrees and jobs (`GET /api/agents/servers/orphans`) with a confirmed Stop (`POST /api/agents/servers/:pid/stop`, orphan pids only); a server now belongs to a session only via its process ancestry or the session's own dir without nested `.claude/worktrees/*` and `.claude/jobs/*` (#243)

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
