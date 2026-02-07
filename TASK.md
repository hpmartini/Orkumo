# TASK.md - DevOrbit Dashboard

## Review Summary

**Date:** 2026-01-03 (Latest Review)
**Reviewer:** Claude Code
**Scope:** Full codebase review including backend services, frontend components, and API layer

### Overview

The codebase is a full-stack application with:

- Express backend server for process management and directory scanning
- Real file system scanning with framework detection
- Process spawning/killing with SSE real-time updates
- Admin panel for directory configuration
- Modular React component architecture

**Major Security Improvements Applied:**

- Command injection prevention with allowlist validation
- Path traversal protection with forbidden paths
- Input validation with Zod schemas
- Rate limiting (100 req/min general, 20 req/min for process ops)
- SSE reconnection with exponential backoff

---

## 🔴 Critical Priority

### Security

- [x] **[SECURITY]** Command injection vulnerability in `server/services/processService.js` - Fixed with command allowlist and dangerous character detection.

- [x] **[SECURITY]** Path traversal risk in `server/services/configService.js` - Fixed with `validatePath()`, forbidden paths list, and symlink validation.

- [x] **[SECURITY]** No input validation on Express endpoints - Fixed with Zod schema validation.

- [x] **[SECURITY]** API key exposed in client bundle - Fixed with backend proxy server.

### Bugs

- [x] **[BUG]** `handleAnalyzeApp` uses mock data - Fixed to fetch real package.json via `/api/apps/:id/package`.

- [x] **[BUG]** SSE JSON.parse errors crash app - Fixed with try-catch wrapper.

- [x] **[BUG]** Sidebar selection only selecting first app - Fixed with SHA256 ID generation.

- [x] **[BUG]** Process PATH missing node_modules/.bin - Fixed in processService.js.

---

## 🟠 High Priority

### Security & Reliability

- [x] **[SECURITY]** Add rate limiting to Express server - Added `express-rate-limit` middleware.

- [x] **[SECURITY]** Process kill in `processService.js:169` uses `-pid` for process group kill which fails silently on some systems. Add cross-platform process tree killing with `tree-kill` package. (Implemented with SIGTERM fallback to SIGKILL)

- [x] **[RELIABILITY]** Memory leak in SSE clients - Fixed with heartbeat/timeout cleanup.

- [x] **[RELIABILITY]** Add SSE reconnection logic - Added with exponential backoff (max 10 attempts, 1-30s delays).

### Features

- [x] **[FEATURE]** Create Admin Panel for directory configuration - Implemented in `components/AdminPanel.tsx`
- [x] **[FEATURE]** Implement real file system scanning - Implemented in `server/services/scannerService.js`
- [x] **[FEATURE]** Implement real process management - Implemented in `server/services/processService.js`
- [x] **[FEATURE]** Implement real CPU/memory metrics using `pidusage` - Added with `/api/apps/:id/stats` endpoint.

- [x] **[FEATURE]** Add custom port setting UI in app detail view - Allow users to override detected port. (Already implemented in AppDetail.tsx with persistence via updatePort API)
- [ ] **[FEATURE]** Add recommendations panel showing "possible optimizations, updates, etc."

### Architecture

- [x] **[REFACTOR]** Decompose App.tsx into modular components - Done (9 components)
- [x] **[REFACTOR]** Extract state management into custom hooks - Done (useApps.ts)
- [ ] **[REFACTOR]** Add TypeScript to server code (currently plain .js files) - Consider migrating `server/*.js` to TypeScript
- [ ] **[REFACTOR]** Create shared types package for frontend/backend type consistency

### Error Handling

- [x] **[RELIABILITY]** Add React Error Boundary - Added `ErrorBoundary.tsx`
- [x] **[RELIABILITY]** Add retry logic with exponential backoff for failed HTTP API requests (not just SSE)
  - Added `fetchWithRetry()` utility in `services/api.ts`
  - Max 3 retries with delays: 1s, 2s, 4s
  - Applied to key read operations: fetchApps, fetchLogs, fetchConfig, fetchSettings, fetchSystemHealth

---

## 🟡 Medium Priority

### Type Safety

- [ ] **[TYPING]** Remove unsafe type assertions in `services/api.ts:16-32` - Use Zod for runtime validation:

  ```typescript
  // Current: Multiple `as` casts that could mask errors
  id: app.id as string,
  ```

- [ ] **[TYPING]** AppType enum mismatch - Backend returns 'cra', 'nuxt', 'vue' but frontend `types.ts:12` only has `'vite' | 'next' | 'node' | 'static' | 'unknown'`

- [ ] **[TYPING]** Define proper interfaces for all backend API responses

### Performance

- [x] **[PERFORMANCE]** Terminal virtualization - Added `@tanstack/react-virtual` in `Terminal.tsx`.

- [x] **[PERFORMANCE]** Add `useMemo` for chart data - Done in PerformanceCharts.tsx

- [x] **[PERFORMANCE]** Stats polling interval runs for ALL apps every 2s (`useApps.ts:94-133`). Consider only fetching stats for selected/visible app.
  - Analyzed: Already uses SSE streaming, server only sends stats for running apps. No change needed.

### UI/UX

- [x] **[UI]** Add loading skeleton states during initial scan instead of just spinner
  - Created `LoadingSkeleton` component with sidebar and content area placeholders
  - Mimics main app layout for better perceived performance
- [x] **[UI]** Add toast notifications for actions - Added `react-hot-toast` with Toaster component.
- [x] **[UI]** Mobile responsiveness - Added hamburger menu in `App.tsx`.
- [x] **[UI]** Add keyboard shortcuts (Ctrl+Enter to start, Ctrl+. to stop)
  - Added `startApp`, `stopApp`, `restartApp` shortcuts to KeyboardShortcuts type
  - Default bindings: ⌘/Ctrl+Enter (start), ⌘/Ctrl+. (stop), ⌘/Ctrl+Shift+R (restart)
  - Integrated with existing keyboard shortcuts system (configurable)
- [x] **[UI]** Show app's actual path in AppDetail header (currently only shows command)
  - Already implemented - path shown below app name with folder icon
- [x] **[UI]** Add app path tooltip or display in Sidebar items
  - Added `title={app.path}` to sidebar app items for hover tooltip

### Data Persistence

- [x] **[FEATURE]** Remember last selected app on page reload (localStorage)
  - Persist `selectedAppId` to localStorage key `devorbit-last-selected-app`
  - Validates on load that app still exists, clears if not
- [ ] **[FEATURE]** Persist terminal scroll position per app

---

## 🟢 Low Priority

### Testing

- [x] **[TESTING]** Set up Vitest testing framework - Configured in `vitest.config.ts`
- [ ] **[TESTING]** Add unit tests for `scannerService.js` functions
- [ ] **[TESTING]** Add unit tests for `processService.js` functions
- [ ] **[TESTING]** Add component tests for StatusBadge, Terminal, AppDetail
- [ ] **[TESTING]** Add integration tests for API endpoints
- [ ] **[TESTING]** Add E2E tests with Playwright for critical flows

### Documentation

- [ ] **[DOCS]** Create API documentation (OpenAPI/Swagger spec)
- [ ] **[DOCS]** Add README.md with setup instructions, architecture overview

### Code Quality

- [x] **[CLEANUP]** Add ESLint configuration - Added `eslint.config.js`
- [x] **[CLEANUP]** Add Prettier configuration - Added `.prettierrc`
- [x] **[CLEANUP]** Remove unused `services/mockOs.ts` (replaced by real scanner)
- [ ] **[CLEANUP]** Extract Tailwind custom colors from `index.html` to `tailwind.config.js`
- [x] **[CLEANUP]** Add `.nvmrc` with Node version (e.g., `v20`)
- [ ] **[CLEANUP]** Consistent file naming (some PascalCase, some camelCase in components)

### DevOps

- [x] **[DEVOPS]** Add pre-commit hooks with Husky/lint-staged
- [x] **[DEVOPS]** Add GitHub Actions CI workflow
- [x] **[DEVOPS]** Add Dockerfile for containerized deployment

---

## Implementation Notes

### Completed (2026-02-06)

**Multi-Tab Stability Fixes:**

1. Fixed code-server race condition with shared promise coordination across WebIDEPanel instances
2. Added module-level lock to prevent concurrent code-server start/stop operations
3. Iframe src gated by `codeServerReady` state - prevents ERR_CONNECTION_REFUSED errors
4. Added 30-second minimum interval between restart attempts to prevent cascade failures
5. Fixed iframe bleed-through between tabs using `clip-path` + `position: fixed` + `left: -200vw`

**Server Stability:**

1. Stats streaming backpressure control - prevents memory leak from stacking intervals
2. Enhanced health endpoint with memory, uptime, SSE client counts, code-server status
3. Better code-server process management - captures stdout/stderr, handles exit/error events
4. Improved graceful shutdown - properly closes all SSE connections, kills code-server

### Completed (2026-01-03)

**Security Hardening:**

1. Command injection prevention - `processService.js` validates against allowlist (npm, npx, yarn, pnpm, node, bun) and blocks dangerous shell characters
2. Path traversal protection - `configService.js` validates paths against forbidden list (/etc, /var, ~/.ssh, etc.) and checks symlinks
3. Input validation - All Express endpoints use Zod schemas
4. Rate limiting - General (100/min) and process operations (20/min)

**Reliability:**

1. SSE reconnection with exponential backoff (10 attempts, 1-30s delays)
2. SSE heartbeat (30s) and client timeout cleanup (2min)
3. Real CPU/memory metrics via `pidusage`

**UI/UX:**

1. Toast notifications with `react-hot-toast`
2. Mobile hamburger menu with slide-in sidebar
3. Terminal virtualization with `@tanstack/react-virtual`
4. Color-coded log lines (errors=red, warnings=yellow, system=blue)

**Developer Tooling:**

1. Vitest configured with jsdom environment
2. ESLint 9 with TypeScript and React rules
3. Prettier with consistent formatting

### Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                     React Frontend                          │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐   │
│  │  App.tsx │  │  Sidebar │  │AppDetail │  │ Terminal │   │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘   │
│       │             │             │             │          │
│       └─────────────┴──────┬──────┴─────────────┘          │
│                            │                               │
│                     ┌──────┴──────┐                        │
│                     │  useApps()  │                        │
│                     └──────┬──────┘                        │
│                            │                               │
│                     ┌──────┴──────┐                        │
│                     │ services/   │                        │
│                     │   api.ts    │ ──── SSE ────┐         │
│                     └──────┬──────┘              │         │
└────────────────────────────┼─────────────────────┼─────────┘
                             │ HTTP               │
┌────────────────────────────┼─────────────────────┼─────────┐
│                     Express Server              │         │
│                     ┌──────┴──────┐      ┌──────┴──────┐  │
│                     │  index.js   │──────│ SSE Clients │  │
│                     │ (rate-limit)│      │ (heartbeat) │  │
│                     │   (zod)     │      └─────────────┘  │
│                     └──────┬──────┘                       │
│         ┌──────────────────┼──────────────────┐           │
│   ┌─────┴─────┐    ┌───────┴───────┐   ┌──────┴──────┐   │
│   │ configSvc │    │  scannerSvc   │   │ processSvc  │   │
│   │  (JSON)   │    │ (fs.readdir)  │   │ (spawn/kill)│   │
│   │ (pathVal) │    │               │   │ (cmdValid)  │   │
│   └───────────┘    └───────────────┘   │ (pidusage)  │   │
│                                        └─────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

### Tech Stack

- **Frontend:** React 19, TypeScript, Vite 6, Tailwind CSS, Recharts, @tanstack/react-virtual
- **Backend:** Express 5, Node.js ESM, Zod, express-rate-limit, pidusage
- **Real-time:** Server-Sent Events (SSE) with heartbeat
- **AI:** Google Gemini API (via backend proxy)
- **Testing:** Vitest, @testing-library/react
- **Linting:** ESLint 9, Prettier

### Priority Order for Next Steps

1. **Remove dead code** - Delete unused `services/mockOs.ts`
2. **Fix type mismatches** - Align AppType enum between frontend/backend
3. **Add app path display** - Show in AppDetail header and Sidebar tooltip
4. **Expand test coverage** - Add tests for scannerService, processService
5. **Add README** - Setup instructions and architecture documentation

---

## 📋 Upcoming Tasks

### 🐛 Bug Fix: Prevent Process Suspension on Tab Switch (High Priority)

**Problem:** Switching tabs unmounts AppDetail, killing iframes, terminals, and WebSocket connections.

**Solution:** Render one AppDetail per open tab simultaneously using offscreen positioning instead of unmounting.

#### Tasks

- [x] **[BUG]** Refactor tab system to keep all open AppDetail components mounted
  - Use CSS `visibility: hidden` / `position: fixed` / `left: -200vw` / `clip-path` for inactive tabs
  - Preserve iframe state (code-server, browser preview)
  - Preserve terminal sessions and WebSocket connections
  - Fixed iframe bleed-through issue with proper clip-path containment

- [x] **[UI]** AppDetail: Add "Code" button for quick view switching
  - Added toggle button in header action buttons
  - Shows "Code" when in details view, "Details" when in coding view
  - Uses blue accent when in coding view for visual feedback

- [x] **[UI]** BrowserPreviewPanel improvements:
  - Add DevTools toggle button in header (Added toggle with active state highlighting)
  - Improve layout consistency with ElectronBrowserView

- [ ] **[PERF]** ElectronBrowserView optimizations:
  - Debounce resize calls to reduce API overhead
  - Track visibility and move BrowserView off-screen when hidden
  - Avoid redundant resize/navigate calls
  - Better URL change handling

- [x] **[UI]** WebIDEPanel improvements:
  - Add Details button for view switching
  - Poll code-server status for reliable loading detection
  - Fixed multi-tab race condition with shared promise coordination
  - Added backpressure control and 30s restart interval to prevent cascade failures
  - Iframe src gated by codeServerReady state to prevent ERR_CONNECTION_REFUSED

- [x] **[UI]** Add favicon to index.html (Added SVG favicon with orbit design)

---

### ✨ Feature: Custom Commands, Docker Support, System Health & Recommendations

#### Custom Commands & Port Injection

- [x] **[FEATURE]** Persist and edit custom run commands per app
  - Added `customCommands` field to settings in `settingsService.js`
  - Added API endpoints: `PUT /api/settings/command/:id`, `GET /api/settings/command/:id`
  - Added UI in AppDetail to view/edit custom command (inline editor)
  - Added `handleSetCommand` in useApps.ts with optimistic updates

- [x] **[FEATURE]** Inject per-framework port flags when starting apps
  - Added `injectPortFlag()` in `processService.js`
  - Auto-appends `-- --port XXXX` to npm/yarn/pnpm commands
  - Works with Vite, Nuxt, Vue, Next.js (all use `--port`)
  - PORT environment variable also set as fallback

#### Docker Support

- [x] **[FEATURE]** Detect Docker Compose projects in scanner
  - Check for `docker-compose.yml`, `docker-compose.yaml`, `compose.yml`, `compose.yaml`
  - Validate compose commands available (`docker compose` or `docker-compose`)
  - Add `AppType: 'docker-compose'` to types

- [x] **[FEATURE]** Configure Docker projects for container management
  - Parse compose file to extract service names
  - Store container IDs for running services
  - API endpoints at `/api/apps/:id/docker/*` (status, services, start, stop, restart, logs, pull, build, down)

- [x] **[FEATURE]** Add container controls in AppDetail view
  - Start/stop/restart individual containers and all services
  - View container logs per service
  - Show container status (running, exited, paused, created)
  - Pull images, build images, docker compose down actions
  - DockerControls component in `components/DockerControls.tsx`

#### System Health Service

- [x] **[FEATURE]** Add system health service (`server/services/healthService.js`)
  - Check Node.js version and compare to LTS
  - Check npm/yarn/pnpm versions
  - Check Git version
  - Check Docker availability and version
  - Check disk space on home directory
  - API endpoints: `GET /api/system/health`, `GET /api/system/versions`

- [x] **[FEATURE]** Add project-level health checks
  - Check node_modules existence
  - Stale dependencies (package-lock.json age > 90 days)
  - Missing `.nvmrc` or `.node-version`
  - TypeScript and ESLint configuration
  - `.gitignore` presence
  - API endpoint: `GET /api/apps/:id/health`

- [x] **[FEATURE]** Support Node/npm updates via detected version manager
  - Detect nvm, volta, fnm, asdf, or system Node
  - Provide appropriate update commands in recommendations
  - Display version manager info in SystemHealth UI

#### Actionable Recommendations

- [x] **[FEATURE]** Replace hardcoded SystemAlerts with live health data
  - Created `SystemHealth` component (`components/SystemHealth.tsx`)
  - Display system resource usage (CPU, memory, disk)
  - Display tool versions (Node, npm, Git, Docker)
  - Generate and display recommendations with severity levels
  - Show actionable fix commands for each recommendation

- [x] **[FEATURE]** Add actionable recommendations engine
  - Added one-click "Restart App" button for crashed/failed apps
  - Added one-click "Install Dependencies" button for missing node_modules
  - RecommendationCard now extracts appId from message and shows quick action buttons
  - Handlers passed from App.tsx through SystemHealth component

- [x] **[FEATURE]** Surface system-level recommendations from health data
  - Expandable details for each recommendation
  - Severity levels (info, warning, error)
  - Dismiss/snooze functionality (24h snooze, permanent dismiss)

---

### Related Existing Tasks (Updated Context)

The following existing tasks are related to the new features above:

| Existing Task              | Related New Task                  |
| -------------------------- | --------------------------------- |
| Custom port setting UI     | Custom commands & port injection  |
| Recommendations panel      | Actionable recommendations engine |
| Stats polling optimization | ElectronBrowserView optimizations |
