# TASK.md - DevOrbit Dashboard

## Review Summary

**Date:** 2026-01-03
**Reviewer:** Claude Code
**Scope:** Full codebase review comparing implementation vs CLAUDE.md requirements

### Overview

The codebase has been significantly refactored from a 528-line monolithic `App.tsx` into a modular architecture with separate components, hooks, and a backend proxy for secure API handling.

---

## 🔴 Critical Priority

### Security

- [x] **[SECURITY]** API key exposed in client bundle via `vite.config.ts:14-15` - ✅ Fixed: Created backend proxy server (`server/index.js`) that securely handles API key
- [x] **[SECURITY]** No validation of AI response structure in `services/geminiService.ts:54` before `JSON.parse()` - ✅ Fixed: Added `isValidAnalysisResult` type guard

### Bugs

- [x] **[BUG]** Stale closure in `handleAnalyzeApp` - ✅ Fixed: Now uses callback pattern to get current state
- [x] **[BUG]** Timer interval type mismatch - ✅ Fixed: Using `ReturnType<typeof setInterval>` in hooks/useApps.ts

### Missing Core Functionality

- [ ] **[FEATURE]** Implement real file system scanning to replace `services/mockOs.ts` mock data - CLAUDE.md requires scanning configured directories.
- [ ] **[FEATURE]** Implement real process management (spawn/kill processes) - current start/stop only changes UI state.
- [ ] **[FEATURE]** Implement real console output capture from spawned processes into terminal view.

---

## 🟠 High Priority

### Architecture Refactoring

- [x] **[REFACTOR]** Decompose `App.tsx` (528 lines → 135 lines) into smaller components:
  - ✅ `components/StatusBadge.tsx`
  - ✅ `components/DashboardOverview.tsx`
  - ✅ `components/AppList.tsx`
  - ✅ `components/AppDetail.tsx`
  - ✅ `components/Sidebar.tsx`
  - ✅ `components/PerformanceCharts.tsx`
  - ✅ `components/Terminal.tsx`
  - ✅ `components/SystemAlerts.tsx`
  - ✅ `components/ErrorBoundary.tsx`

- [x] **[REFACTOR]** Extract state management into custom hooks:
  - ✅ `hooks/useApps.ts` - app list state, CRUD operations, process simulation, and controls

- [ ] **[REFACTOR]** Create service layer abstraction in `services/`:
  - `processService.ts` - process spawn/kill/monitor
  - `fileSystemService.ts` - directory scanning
  - `configService.ts` - app configuration persistence

### Missing Features (per CLAUDE.md)

- [ ] **[FEATURE]** Create Admin Panel for directory configuration - CLAUDE.md specifies "directories can be configured on the admin panel"
- [x] **[FEATURE]** Add restart functionality - ✅ Added restart button and handler in `AppDetail.tsx` and `useApps.ts`
- [ ] **[FEATURE]** Add custom port setting UI in app detail view
- [x] **[FEATURE]** Implement working "Open in browser" button - ✅ Now functional in `useApps.ts:handleOpenInBrowser`
- [x] **[FEATURE]** Display addresses alongside ports per CLAUDE.md requirements - ✅ Added `addresses` field to types and display in `AppDetail.tsx`
- [ ] **[FEATURE]** Add recommendations panel showing "possible optimizations, updates, etc."

### Error Handling

- [x] **[RELIABILITY]** Add React Error Boundary wrapper around main app - ✅ Added `ErrorBoundary.tsx` component
- [x] **[RELIABILITY]** Add error handling for `scanDirectory()` failure - ✅ Added try/catch in `useApps.ts:refreshApps`
- [ ] **[RELIABILITY]** Add retry logic for failed AI analysis requests

### TypeScript

- [x] **[TYPING]** Enable strict mode in `tsconfig.json` - ✅ Added `"strict": true` and related options
- [x] **[TYPING]** Add missing status values to `AppStatus` enum - ✅ Added `CANCELLED`, `WAITING`, `RESTARTING`
- [x] **[TYPING]** Add `addresses?: string[]` field to `AppConfig` interface - ✅ Done

---

## 🟡 Medium Priority

### Performance

- [ ] **[PERFORMANCE]** Optimize simulation interval - currently runs for ALL apps every 1s. Consider:
  - Only simulate visible/selected app
  - Use Web Workers for background processing
  - Reduce frequency for non-focused apps

- [x] **[PERFORMANCE]** Add `useMemo` for expensive calculations:
  - ✅ `chartData` in `PerformanceCharts.tsx` now uses `useMemo`

- [x] **[PERFORMANCE]** Add `useCallback` for handler functions - ✅ All handlers in `useApps.ts` wrapped with `useCallback`

- [ ] **[PERFORMANCE]** Implement virtualization for log list in terminal view - currently renders all 50 logs

### UI/UX Improvements

- [ ] **[UI]** Add loading skeleton states during initial scan
- [ ] **[UI]** Add toast notifications for actions (start, stop, analyze complete)
- [ ] **[UI]** Improve mobile responsiveness - sidebar hidden on mobile but no hamburger menu
- [ ] **[UI]** Add keyboard shortcuts for common actions (start/stop selected app)

### Code Quality

- [ ] **[REFACTOR]** Extract Tailwind color definitions from `index.html:17-23` to proper Tailwind config file
- [x] **[REFACTOR]** Move hardcoded model name to server - ✅ Now in `server/index.js`
- [x] **[REFACTOR]** Replace magic numbers in simulation logic with named constants - ✅ Added `SIMULATION_INTERVAL_MS`, `LOG_RETENTION_COUNT`, `LOG_GENERATION_CHANCE`

### Data Persistence

- [ ] **[FEATURE]** Persist app configurations to localStorage or IndexedDB
- [ ] **[FEATURE]** Remember last selected app and active tab on page reload

---

## 🟢 Low Priority

### Testing

- [ ] **[TESTING]** Set up Vitest testing framework - add to `package.json`
- [ ] **[TESTING]** Add unit tests for `geminiService.ts` functions
- [ ] **[TESTING]** Add unit tests for `mockOs.ts` functions
- [ ] **[TESTING]** Add component tests for `StatusBadge`
- [ ] **[TESTING]** Add integration tests for app lifecycle (start -> running -> stop)

### Documentation

- [x] **[DOCS]** Add JSDoc comments to exported functions in services - ✅ Added to `geminiService.ts`
- [ ] **[DOCS]** Add prop types documentation for components once extracted
- [ ] **[DOCS]** Create API documentation for AI integration

### Cleanup

- [x] **[CLEANUP]** Remove unused `LineChart` import - ✅ Removed during refactor
- [ ] **[CLEANUP]** Add `.nvmrc` or `engines` field to `package.json` for Node version specification
- [ ] **[CLEANUP]** Add `index.css` file referenced in `index.html:46` but doesn't exist

### DevOps

- [ ] **[DEVOPS]** Add ESLint configuration
- [ ] **[DEVOPS]** Add Prettier configuration
- [ ] **[DEVOPS]** Add pre-commit hooks with Husky
- [ ] **[DEVOPS]** Add GitHub Actions CI workflow

---

## Implementation Notes

### Completed Changes (2026-01-03)

1. **Backend Proxy Server** (`server/index.js`)
   - Express server on port 3001
   - Securely handles GEMINI_API_KEY
   - POST `/api/analyze` endpoint for AI config analysis
   - GET `/api/health` for status checks

2. **Modular Component Architecture**
   - 9 extracted components in `components/`
   - 1 custom hook in `hooks/`
   - Clean separation of concerns

3. **TypeScript Strict Mode**
   - Full strict mode enabled
   - All type errors resolved

4. **New Scripts**
   - `npm run dev` - runs both backend and frontend concurrently
   - `npm run server` - backend only
   - `npm run client` - frontend only

### Remaining Work (Priority Order)

1. Implement real file system scanning
2. Implement real process management
3. Add admin panel for directory configuration
4. Performance optimizations
5. Testing setup

### Tech Stack Additions to Consider

- **State Management:** Zustand (lightweight) or Jotai for complex state
- **Process Management:** Node.js `child_process` via Electron or backend server
- **Terminal:** xterm.js for real terminal emulation
- **Testing:** Vitest + React Testing Library
