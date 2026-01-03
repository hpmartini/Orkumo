# TASK.md - DevOrbit Dashboard

## Review Summary

**Date:** 2026-01-03 (Updated)
**Reviewer:** Claude Code
**Scope:** Full codebase review including backend services, frontend components, and API layer

### Overview

The codebase has evolved from a mock-only frontend to a full-stack application with:
- Express backend server for process management and directory scanning
- Real file system scanning with framework detection
- Process spawning/killing with SSE real-time updates
- Admin panel for directory configuration
- Modular React component architecture

**Recent Fixes Applied:**
- Fixed sidebar selection bug (ID collision with SHA256 hash)
- Fixed process PATH issue (local node_modules/.bin added to PATH)

---

## 🔴 Critical Priority

### Security

- [ ] **[SECURITY]** Command injection vulnerability in `server/services/processService.js:70` - Command is passed to `spawn()` with `shell: true`. User-controlled commands from API could execute arbitrary code.
  ```javascript
  // VULNERABLE: command could be "npm run dev; rm -rf /"
  const childProcess = spawn(cmd, args, { shell: true, ... });
  ```
  **Fix:** Validate commands against allowlist, or use spawn without shell and proper argument parsing.

- [ ] **[SECURITY]** Path traversal risk in `server/services/configService.js:59-65` - `addDirectory()` accepts any path without validation. Attacker could add sensitive directories like `/etc` or `~/.ssh`.
  **Fix:** Validate paths are within allowed parent directories, check for symlinks.

- [ ] **[SECURITY]** No input validation/sanitization on Express endpoints in `server/index.js`. All `req.body` and `req.params` values used directly.
  **Fix:** Add express-validator or zod schema validation.

- [x] **[SECURITY]** API key exposed in client bundle - ✅ Fixed: Backend proxy server handles API key

### Bugs

- [ ] **[BUG]** `handleAnalyzeApp` in `hooks/useApps.ts:216-224` uses hardcoded mock package.json instead of reading real file from the app's directory.
  ```javascript
  // Currently creates fake data:
  const mockPackageJson = JSON.stringify({ name: appName, ... });
  ```
  **Fix:** Call backend endpoint to read actual package.json from app.path.

- [ ] **[BUG]** SSE event handlers in `services/api.ts:170-177` don't handle JSON.parse errors - malformed server data could crash the app.
  ```javascript
  eventSource.addEventListener('process-status', (event) => {
    const data = JSON.parse(event.data); // Could throw!
    onStatusChange(data);
  });
  ```

- [x] **[BUG]** Stale closure in `handleAnalyzeApp` - ✅ Fixed with callback pattern
- [x] **[BUG]** Sidebar selection only selecting first app - ✅ Fixed with SHA256 ID generation
- [x] **[BUG]** Process PATH missing node_modules/.bin - ✅ Fixed in processService.js

---

## 🟠 High Priority

### Security & Reliability

- [ ] **[SECURITY]** Add rate limiting to Express server - currently no protection against DoS.
  **Fix:** Add `express-rate-limit` middleware.

- [ ] **[SECURITY]** Process kill in `processService.js:169` uses `-pid` for process group kill which fails silently on some systems. Add proper error handling.

- [ ] **[RELIABILITY]** Memory leak potential in SSE clients `server/index.js:33-48`. The `sseClients` Set grows but only removes on 'close'. Add heartbeat/timeout cleanup.

- [ ] **[RELIABILITY]** Add try-catch around JSON.parse in SSE handlers (`services/api.ts:170-177`).

### Missing Features (per CLAUDE.md)

- [x] **[FEATURE]** Create Admin Panel for directory configuration - ✅ Implemented in `components/AdminPanel.tsx`
- [x] **[FEATURE]** Implement real file system scanning - ✅ Implemented in `server/services/scannerService.js`
- [x] **[FEATURE]** Implement real process management - ✅ Implemented in `server/services/processService.js`
- [ ] **[FEATURE]** Add custom port setting UI in app detail view
- [ ] **[FEATURE]** Add recommendations panel showing "possible optimizations, updates, etc."
- [ ] **[FEATURE]** Implement real CPU/memory metrics using `pidusage` or similar (currently simulated in `useApps.ts:91-125`)

### Architecture

- [x] **[REFACTOR]** Decompose App.tsx into modular components - ✅ Done (9 components)
- [x] **[REFACTOR]** Extract state management into custom hooks - ✅ Done (useApps.ts)
- [ ] **[REFACTOR]** Add TypeScript to server code (currently plain .js files)
- [ ] **[REFACTOR]** Create shared types package for frontend/backend type consistency

### Error Handling

- [x] **[RELIABILITY]** Add React Error Boundary - ✅ Added `ErrorBoundary.tsx`
- [ ] **[RELIABILITY]** Add retry logic with exponential backoff for failed API requests
- [ ] **[RELIABILITY]** Add SSE reconnection logic with backoff (currently just warns on error)

---

## 🟡 Medium Priority

### Type Safety

- [ ] **[TYPING]** Remove unsafe type assertions in `services/api.ts:16-32`:
  ```typescript
  // Multiple `as` casts that could mask errors:
  id: app.id as string,
  name: app.name as string,
  ```
  **Fix:** Use zod or io-ts for runtime validation.

- [ ] **[TYPING]** Add `@types/cors` and `@types/express` to devDependencies for server code.

- [ ] **[TYPING]** Define proper interfaces for backend API responses.

### Performance

- [ ] **[PERFORMANCE]** Stats simulation interval runs for ALL apps every 2s (`useApps.ts:92-120`). Consider:
  - Only update visible/selected app
  - Use requestAnimationFrame for UI updates
  - Implement real metrics via backend

- [ ] **[PERFORMANCE]** Terminal renders all logs without virtualization (`Terminal.tsx:40-45`). Use `react-window` or `@tanstack/react-virtual` for large log lists.

- [x] **[PERFORMANCE]** Add `useMemo` for chart data - ✅ Done in PerformanceCharts.tsx

### UI/UX

- [ ] **[UI]** Add loading skeleton states during initial scan
- [ ] **[UI]** Add toast notifications for actions (start, stop, analyze complete)
- [ ] **[UI]** Improve mobile responsiveness - sidebar hidden but no hamburger menu
- [ ] **[UI]** Add keyboard shortcuts (Ctrl+Enter to start, Ctrl+. to stop)
- [ ] **[UI]** Show app's actual path in detail view header

### Data Persistence

- [ ] **[FEATURE]** Remember last selected app on page reload (localStorage)
- [ ] **[FEATURE]** Persist terminal scroll position per app

---

## 🟢 Low Priority

### Testing

- [ ] **[TESTING]** Set up Vitest testing framework
- [ ] **[TESTING]** Add unit tests for `scannerService.js` functions
- [ ] **[TESTING]** Add unit tests for `processService.js` functions
- [ ] **[TESTING]** Add component tests for StatusBadge, Terminal
- [ ] **[TESTING]** Add E2E tests with Playwright for critical flows

### Documentation

- [x] **[DOCS]** Add JSDoc to services - ✅ Added to key functions
- [ ] **[DOCS]** Create API documentation (OpenAPI/Swagger spec)
- [ ] **[DOCS]** Add README with setup instructions

### Code Quality

- [ ] **[CLEANUP]** Extract Tailwind custom colors from `index.html` to `tailwind.config.js`
- [ ] **[CLEANUP]** Add `.nvmrc` with Node version
- [ ] **[CLEANUP]** Consistent file naming (some PascalCase, some camelCase)
- [ ] **[CLEANUP]** Remove unused `services/mockOs.ts` (replaced by real scanner)

### DevOps

- [ ] **[DEVOPS]** Add ESLint configuration
- [ ] **[DEVOPS]** Add Prettier configuration
- [ ] **[DEVOPS]** Add pre-commit hooks with Husky/lint-staged
- [ ] **[DEVOPS]** Add GitHub Actions CI workflow
- [ ] **[DEVOPS]** Add Dockerfile for containerized deployment

---

## Implementation Notes

### Completed (2026-01-03)

1. **Backend Services**
   - `server/index.js` - Express API server with SSE support
   - `server/services/configService.js` - Configuration persistence
   - `server/services/scannerService.js` - Real file system scanning
   - `server/services/processService.js` - Process spawn/kill management

2. **Frontend Improvements**
   - `services/api.ts` - Full API client with SSE subscription
   - `components/AdminPanel.tsx` - Directory configuration UI
   - Fixed ID generation for unique app selection
   - Fixed PATH for local node_modules binaries

3. **Bug Fixes**
   - SHA256 hash for unique project IDs
   - Added node_modules/.bin to PATH for spawned processes

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
│                     └──────┬──────┘      └─────────────┘  │
│         ┌──────────────────┼──────────────────┐           │
│   ┌─────┴─────┐    ┌───────┴───────┐   ┌──────┴──────┐   │
│   │ configSvc │    │  scannerSvc   │   │ processSvc  │   │
│   │  (JSON)   │    │ (fs.readdir)  │   │ (spawn/kill)│   │
│   └───────────┘    └───────────────┘   └─────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

### Tech Stack

- **Frontend:** React 19, TypeScript, Vite, Tailwind CSS, Recharts
- **Backend:** Express 5, Node.js ESM
- **Real-time:** Server-Sent Events (SSE)
- **AI:** Google Gemini API (via backend proxy)

### Priority Order for Next Steps

1. **Security hardening** (command injection, input validation)
2. **Fix handleAnalyzeApp** to use real package.json
3. **Add SSE error handling** and reconnection logic
4. **Real CPU/memory metrics** using pidusage
5. **Testing setup** with Vitest
