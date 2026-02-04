# Implementation Plan: Tab Persistence with Hybrid Architecture

**Date:** 2026-02-04
**Status:** Approved for implementation

## Problem Statement

When switching between app tabs in DevOrbit Dashboard:
1. VS Code Server iframe reloads, losing all state (open files, cursor positions, unsaved changes)
2. Browser preview iframe reloads
3. Previous multi-tab fix caused 429 (Too Many Requests) errors

## Root Cause Analysis

### Current Architecture (App.tsx)
Renders **only ONE** `AppDetail` component. When switching tabs:
- React unmounts/remounts `AppDetail`
- Child iframes are destroyed and recreated
- All state is lost

### Previous Multi-Tab Approach (Rolled Back)
Rendered ALL tabs simultaneously with CSS visibility. **Failed because:**
- Hidden tabs continued making API calls
- 100 req/min rate limit was exceeded
- Caused 429 errors flooding the console

### Why `isVisible` Prop Fix Failed
Documented in `.claude/failed-approaches.md`:
- Complex prop drilling
- Broke component lifecycles
- Fundamentally incompatible with React state management
- **DO NOT RETRY THIS APPROACH**

## Selected Solution: Hybrid Architecture

### For Web Browser: Iframe Pool + Request Deduplication
- Keep all tab iframes mounted in DOM
- Position inactive tabs off-screen (`left: -9999px`)
- Fix API calls to prevent 429 errors

### For Electron (Desktop): Native BrowserView
- Each tab becomes a native Chromium process
- True process isolation
- Best performance and stability

## Implementation Phases

### Phase 1: Fix API Rate Limiting

**Files to modify:**
- `server/index.js` - Increase rate limits
- `services/api.ts` - Singleton SSE manager
- `hooks/useApps.ts` - Use shared SSE connection

**Changes:**

1. **Increase global rate limit** (server/index.js:85-91)
```javascript
const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 500, // Changed from 100
  message: { error: 'Too many requests, please try again later' },
});
```

2. **Exempt SSE endpoints from rate limiting**
```javascript
// Add before app.use(limiter)
app.use('/api/events', (req, res, next) => next()); // Skip rate limiting for SSE
app.use('/api/apps/stats/stream', (req, res, next) => next());
```

3. **Create singleton SSE manager** (services/sseManager.ts)
```typescript
class SSEConnectionManager {
  private eventsSource: EventSource | null = null;
  private subscribers = new Map<string, Set<Function>>();

  subscribe(callback: Function): () => void {
    if (!this.eventsSource) {
      this.eventsSource = new EventSource(`${API_BASE_URL}/events`);
      // Set up event handlers...
    }
    // Add subscriber, return unsubscribe function
  }
}

export const sseManager = new SSEConnectionManager();
```

4. **Update useApps hook** to use singleton
```typescript
// In useApps.ts
import { sseManager } from '../services/sseManager';

// Replace direct EventSource creation with:
useEffect(() => {
  const unsubscribe = sseManager.subscribe((event) => {
    // Handle event
  });
  return unsubscribe;
}, []);
```

### Phase 2: Restore Multi-Tab Rendering

**Files to modify:**
- `App.tsx` - Render all tabs simultaneously

**Changes:**

Replace single `AppDetail` with tab mapping:
```tsx
) : (
  <div className="relative flex-1 h-full">
    {tabs.map((tab) => {
      const tabApp = apps.find((a) => a.id === tab.appId);
      const isActive = tab.appId === selectedAppId;
      return (
        <div
          key={tab.appId}
          className={`absolute inset-0 ${
            isActive ? 'z-10 visible' : 'z-0 invisible pointer-events-none'
          }`}
          style={{ left: isActive ? 0 : '-9999px' }}
          aria-hidden={!isActive}
        >
          <AppDetail
            app={tabApp ?? null}
            // ... other props
            perAppState={tabApp ? createAppStateHelpers(tabApp.id) : undefined}
          />
        </div>
      );
    })}
  </div>
)}
```

### Phase 3: Electron BrowserView Integration

**Files to modify:**
- `electron/main.ts` - BrowserView management
- `components/CodingView/WebIDEPanel.tsx` - Use BrowserView when available

**Changes:**

1. **BrowserView manager in main process**
```typescript
// electron/main.ts
const browserViews = new Map<string, BrowserView>();

ipcMain.handle('create-browser-view', (event, { tabId, url }) => {
  const view = new BrowserView({ webPreferences: { nodeIntegration: false } });
  browserViews.set(tabId, view);
  mainWindow.addBrowserView(view);
  view.webContents.loadURL(url);
});

ipcMain.handle('switch-tab', (event, { activeTabId }) => {
  browserViews.forEach((view, tabId) => {
    if (tabId === activeTabId) {
      view.setBounds({ x: 0, y: TAB_BAR_HEIGHT, width, height });
    } else {
      view.setBounds({ x: 0, y: 0, width: 0, height: 0 });
    }
  });
});

ipcMain.handle('close-tab', (event, { tabId }) => {
  const view = browserViews.get(tabId);
  if (view) {
    mainWindow.removeBrowserView(view);
    view.webContents.close();
    browserViews.delete(tabId);
  }
});
```

2. **Renderer integration**
```typescript
// In WebIDEPanel.tsx
if (window.electronAPI?.browserView) {
  // Use Electron BrowserView instead of iframe
  useEffect(() => {
    window.electronAPI.browserView.create(tabId, codeServerUrl);
    return () => window.electronAPI.browserView.close(tabId);
  }, [tabId]);
} else {
  // Use iframe for web browser
}
```

## Verification Steps

### After Phase 1:
- [ ] Open 5+ app tabs rapidly
- [ ] Switch between tabs repeatedly
- [ ] Verify no 429 errors in Network tab
- [ ] Confirm only 2 SSE connections total (not 2 per tab)

### After Phase 2:
- [ ] Open app tab → Coding view → let VS Code load
- [ ] Open another app tab
- [ ] Switch back to first tab
- [ ] Verify VS Code does NOT show "trust authors" dialog
- [ ] Confirm open files and cursor positions preserved

### After Phase 3:
- [ ] Build Electron app
- [ ] Open multiple app tabs
- [ ] Confirm each tab has its own BrowserView
- [ ] Switch tabs rapidly - verify smooth transitions
- [ ] Close tab - verify BrowserView destroyed

## Risk Mitigation

- **Rollback:** Revert to single-tab by removing `tabs.map()`
- **Feature flag:** Add `ENABLE_MULTI_TAB=true` env var
- **Monitoring:** Log SSE connection count to detect leaks

## Backend Rate Limits Reference

| Limiter | Current | After Phase 1 |
|---------|---------|---------------|
| Global | 100/min | 500/min |
| Process | 20/min | 20/min (unchanged) |
| IDE | 10/min | 10/min (unchanged) |
| SSE | rate-limited | **exempted** |

## Related Documentation

- `.claude/failed-approaches.md` - What NOT to try
- `.claude/ralph-loop.local.md` - Previous investigation notes
