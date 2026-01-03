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

- [ ] **[SECURITY]** Process kill in `processService.js:169` uses `-pid` for process group kill which fails silently on some systems. Add cross-platform process tree killing with `tree-kill` package.

- [x] **[RELIABILITY]** Memory leak in SSE clients - Fixed with heartbeat/timeout cleanup.

- [x] **[RELIABILITY]** Add SSE reconnection logic - Added with exponential backoff (max 10 attempts, 1-30s delays).

### Features

- [x] **[FEATURE]** Create Admin Panel for directory configuration - Implemented in `components/AdminPanel.tsx`
- [x] **[FEATURE]** Implement real file system scanning - Implemented in `server/services/scannerService.js`
- [x] **[FEATURE]** Implement real process management - Implemented in `server/services/processService.js`
- [x] **[FEATURE]** Implement real CPU/memory metrics using `pidusage` - Added with `/api/apps/:id/stats` endpoint.

- [ ] **[FEATURE]** Add custom port setting UI in app detail view - Allow users to override detected port.
- [ ] **[FEATURE]** Add recommendations panel showing "possible optimizations, updates, etc."

### Architecture

- [x] **[REFACTOR]** Decompose App.tsx into modular components - Done (9 components)
- [x] **[REFACTOR]** Extract state management into custom hooks - Done (useApps.ts)
- [ ] **[REFACTOR]** Add TypeScript to server code (currently plain .js files) - Consider migrating `server/*.js` to TypeScript
- [ ] **[REFACTOR]** Create shared types package for frontend/backend type consistency

### Error Handling

- [x] **[RELIABILITY]** Add React Error Boundary - Added `ErrorBoundary.tsx`
- [ ] **[RELIABILITY]** Add retry logic with exponential backoff for failed HTTP API requests (not just SSE)

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

- [ ] **[PERFORMANCE]** Stats polling interval runs for ALL apps every 2s (`useApps.ts:94-133`). Consider only fetching stats for selected/visible app.

### UI/UX

- [ ] **[UI]** Add loading skeleton states during initial scan instead of just spinner
- [x] **[UI]** Add toast notifications for actions - Added `react-hot-toast` with Toaster component.
- [x] **[UI]** Mobile responsiveness - Added hamburger menu in `App.tsx`.
- [ ] **[UI]** Add keyboard shortcuts (Ctrl+Enter to start, Ctrl+. to stop)
- [ ] **[UI]** Show app's actual path in AppDetail header (currently only shows command)
- [ ] **[UI]** Add app path tooltip or display in Sidebar items

### Data Persistence

- [ ] **[FEATURE]** Remember last selected app on page reload (localStorage)
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
- [ ] **[CLEANUP]** Remove unused `services/mockOs.ts` (replaced by real scanner)
- [ ] **[CLEANUP]** Extract Tailwind custom colors from `index.html` to `tailwind.config.js`
- [ ] **[CLEANUP]** Add `.nvmrc` with Node version (e.g., `v20`)
- [ ] **[CLEANUP]** Consistent file naming (some PascalCase, some camelCase in components)

### DevOps

- [ ] **[DEVOPS]** Add pre-commit hooks with Husky/lint-staged
- [ ] **[DEVOPS]** Add GitHub Actions CI workflow
- [ ] **[DEVOPS]** Add Dockerfile for containerized deployment

---

## Implementation Notes

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
