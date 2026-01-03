# TASK.md - DevOrbit Dashboard

## Review Summary

**Date:** 2026-01-03
**Reviewer:** Claude Code
**Scope:** Full codebase review comparing implementation vs CLAUDE.md requirements

### Overview

The current implementation is a **prototype/MVP** with significant gaps between the documented vision and actual functionality. The codebase uses mock data exclusively and lacks real OS integration, admin configuration, and several documented features.

---

## 🔴 Critical Priority

### Security

- [ ] **[SECURITY]** API key exposed in client bundle via `vite.config.ts:14-15` - extractable from browser DevTools. Move to server-side proxy or use authenticated backend.
- [ ] **[SECURITY]** No validation of AI response structure in `services/geminiService.ts:54` before `JSON.parse()` - potential for malformed responses to crash app.

### Bugs

- [ ] **[BUG]** Stale closure in `handleAnalyzeApp` at `App.tsx:134` - uses `apps` from render scope instead of callback pattern. Should use `setApps(currentApps => ...)` pattern consistently.
- [ ] **[BUG]** Timer interval type mismatch at `App.tsx:49` - `intervalRef` typed as `number` but `window.setInterval` returns `number` in browser (correct) vs `NodeJS.Timeout` in Node. Add explicit browser typing.

### Missing Core Functionality

- [ ] **[FEATURE]** Implement real file system scanning to replace `services/mockOs.ts` mock data - CLAUDE.md requires scanning configured directories.
- [ ] **[FEATURE]** Implement real process management (spawn/kill processes) - current start/stop only changes UI state.
- [ ] **[FEATURE]** Implement real console output capture from spawned processes into terminal view.

---

## 🟠 High Priority

### Architecture Refactoring

- [ ] **[REFACTOR]** Decompose `App.tsx` (528 lines) into smaller components:
  - Extract `StatusBadge` to `components/StatusBadge.tsx`
  - Extract `DashboardOverview` to `components/DashboardOverview.tsx`
  - Extract `AppList` to `components/AppList.tsx`
  - Extract `AppDetail` to `components/AppDetail.tsx`
  - Extract `Sidebar` to `components/Sidebar.tsx`
  - Extract `PerformanceCharts` to `components/PerformanceCharts.tsx`
  - Extract `Terminal` to `components/Terminal.tsx`

- [ ] **[REFACTOR]** Extract state management into custom hooks:
  - `useApps()` - app list state and CRUD operations
  - `useProcessSimulation()` - interval-based stats simulation
  - `useAppControls()` - start/stop/restart handlers

- [ ] **[REFACTOR]** Create service layer abstraction in `services/`:
  - `processService.ts` - process spawn/kill/monitor
  - `fileSystemService.ts` - directory scanning
  - `configService.ts` - app configuration persistence

### Missing Features (per CLAUDE.md)

- [ ] **[FEATURE]** Create Admin Panel for directory configuration - CLAUDE.md specifies "directories can be configured on the admin panel"
- [ ] **[FEATURE]** Add restart functionality - button and handler missing
- [ ] **[FEATURE]** Add custom port setting UI in app detail view
- [ ] **[FEATURE]** Implement working "Open in browser" button at `App.tsx:313-319` - currently disabled
- [ ] **[FEATURE]** Display addresses alongside ports per CLAUDE.md requirements
- [ ] **[FEATURE]** Add recommendations panel showing "possible optimizations, updates, etc."

### Error Handling

- [ ] **[RELIABILITY]** Add React Error Boundary wrapper around main app to prevent full crashes
- [ ] **[RELIABILITY]** Add error handling for `scanDirectory()` failure in `App.tsx:52-57`
- [ ] **[RELIABILITY]** Add retry logic for failed AI analysis requests

### TypeScript

- [ ] **[TYPING]** Enable strict mode in `tsconfig.json` - add `"strict": true`
- [ ] **[TYPING]** Add missing status values to `AppStatus` enum in `types.ts`: `CANCELLED`, `WAITING` (per CLAUDE.md)
- [ ] **[TYPING]** Add `addresses?: string[]` field to `AppConfig` interface

---

## 🟡 Medium Priority

### Performance

- [ ] **[PERFORMANCE]** Optimize simulation interval in `App.tsx:61-100` - currently runs for ALL apps every 1s. Consider:
  - Only simulate visible/selected app
  - Use Web Workers for background processing
  - Reduce frequency for non-focused apps

- [ ] **[PERFORMANCE]** Add `useMemo` for expensive calculations:
  - `totalCpu` calculation at `App.tsx:165`
  - `chartData` in `renderAppDetail` at `App.tsx:264-268`

- [ ] **[PERFORMANCE]** Add `useCallback` for handler functions passed to child components:
  - `handleStartApp`, `handleStopApp`, `handleAnalyzeApp`

- [ ] **[PERFORMANCE]** Implement virtualization for log list in terminal view - currently renders all 50 logs

### UI/UX Improvements

- [ ] **[UI]** Add loading skeleton states during initial scan
- [ ] **[UI]** Add toast notifications for actions (start, stop, analyze complete)
- [ ] **[UI]** Improve mobile responsiveness - sidebar hidden on mobile but no hamburger menu
- [ ] **[UI]** Add keyboard shortcuts for common actions (start/stop selected app)

### Code Quality

- [ ] **[REFACTOR]** Extract Tailwind color definitions from `index.html:17-23` to proper Tailwind config file
- [ ] **[REFACTOR]** Move hardcoded model name `"gemini-3-flash-preview"` in `geminiService.ts:35` to environment variable
- [ ] **[REFACTOR]** Replace magic numbers in simulation logic with named constants (e.g., `LOG_RETENTION_COUNT = 50`)

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

- [ ] **[DOCS]** Add JSDoc comments to exported functions in services
- [ ] **[DOCS]** Add prop types documentation for components once extracted
- [ ] **[DOCS]** Create API documentation for AI integration

### Cleanup

- [ ] **[CLEANUP]** Remove unused `LineChart` import in `App.tsx:17` (only `AreaChart` is used)
- [ ] **[CLEANUP]** Add `.nvmrc` or `engines` field to `package.json` for Node version specification
- [ ] **[CLEANUP]** Add `index.css` file referenced in `index.html:46` but doesn't exist

### DevOps

- [ ] **[DEVOPS]** Add ESLint configuration
- [ ] **[DEVOPS]** Add Prettier configuration
- [ ] **[DEVOPS]** Add pre-commit hooks with Husky
- [ ] **[DEVOPS]** Add GitHub Actions CI workflow

---

## Implementation Notes

### Recommended Order

1. Fix critical security issues first (API key exposure)
2. Fix bugs (stale closure)
3. Refactor App.tsx into components (enables parallel work)
4. Implement real file system scanning
5. Implement real process management
6. Add admin panel
7. Performance optimizations
8. Testing

### Tech Stack Additions to Consider

- **State Management:** Zustand (lightweight) or Jotai for complex state
- **Process Management:** Node.js `child_process` via Electron or backend server
- **Terminal:** xterm.js for real terminal emulation
- **Testing:** Vitest + React Testing Library
