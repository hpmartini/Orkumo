# DevOrbit Dashboard - Implementation Plan

This document outlines the planned features, architecture decisions, and implementation details.

## Implementation Status

| Feature                   | Status       | Notes                                                                |
| ------------------------- | ------------ | -------------------------------------------------------------------- |
| Kebab Menu                | ✅ Completed | `components/KebabMenu.tsx` - Full implementation with all menu items |
| Browser-Style Tabs        | ✅ Completed | `components/AppTabs.tsx` - Drag-drop, keyboard nav, auto-open        |
| Port Conflict Auto-Fix    | ✅ Completed | `server/services/PortManager.js` + `PortConflictModal.tsx`           |
| Docker Compose Detection  | ✅ Completed | `server/services/DockerComposeService.js` - Parse & manage           |
| Docker Deployment         | ✅ Completed | `Dockerfile`, `docker-compose.yml`, `docker/init-db.sql`             |
| Open in Finder/Terminal   | ✅ Completed | API endpoints in `server/index.js`                                   |
| Resizable Sidebar         | ✅ Completed | Drag to resize, persisted to localStorage                            |
| Refresh Buttons           | ✅ Completed | Global and per-folder refresh in sidebar                             |
| Favorite Button in Detail | ✅ Completed | Star button in AppDetail header                                      |
| **Backend Persistence**   | ✅ Completed | `server/services/settingsService.js` + `hooks/useApps.ts`            |
| **Architecture Refactor** | ✅ Completed | Backend/frontend separation with REST API                            |
| Database Integration      | 🔲 Pending   | Schema ready, needs PostgreSQL connection                            |
| Persistent Terminals      | 🔲 Pending   | Session manager created, needs full integration                      |

---

## Critical Issue: Settings Persistence

### Problem

Currently, user settings (favorites, archived apps, custom ports, renamed apps) are stored in **browser localStorage**. This causes:

1. **Settings lost when switching browsers** - Each browser has its own localStorage
2. **Settings not synced with Docker** - Docker container runs different browser instance
3. **Settings lost on cache clear** - Browser data deletion removes all settings

### Solution: Backend Persistence Service

Move all user settings from frontend localStorage to backend file-based storage.

### Architecture

```
┌─────────────────┐     REST API      ┌──────────────────┐     File System
│   Browser UI    │ ────────────────► │  Express Server  │ ────────────────► │ data/settings.json
│   (React)       │                   │  (Node.js)       │                   │ data/config.json
└─────────────────┘                   └──────────────────┘                   └──────────────────
        │                                      │
        └──────── WebSocket (PTY) ─────────────┘
```

### Implementation Steps

#### 1. Create Settings Persistence Service

**File**: `server/services/settingsService.js`

```javascript
// Stores:
// - favorites: string[] (app IDs)
// - archived: string[] (app IDs)
// - customPorts: { [appId]: number }
// - customNames: { [appId]: string }

class SettingsService {
  getSettings()
  updateFavorite(appId, isFavorite)
  updateArchived(appId, isArchived)
  updatePort(appId, port)
  updateName(appId, name)
}
```

#### 2. Add API Endpoints

```
GET  /api/settings                  - Get all settings
PUT  /api/settings/favorite/:id     - Toggle favorite
PUT  /api/settings/archive/:id      - Toggle archive
PUT  /api/settings/port/:id         - Set custom port
PUT  /api/settings/name/:id         - Set custom name
```

#### 3. Update Frontend Hook

Modify `hooks/useApps.ts` to:

- Fetch settings from backend on load
- Save settings via API instead of localStorage
- Remove all localStorage calls

---

## Architecture: Backend & Frontend Separation

### Current Architecture

```
┌─────────────────────────────────────────────────────┐
│                  Development                         │
├─────────────────────────────────────────────────────┤
│  Vite Dev Server (localhost:3000)   ◄──── Hot Reload │
│  Express Server (localhost:3099)    ◄──── API + WS   │
└─────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────┐
│                  Production                          │
├─────────────────────────────────────────────────────┤
│  Express Server (localhost:3099)                     │
│    ├── API Routes (/api/*)                          │
│    ├── WebSocket (/api/pty)                         │
│    └── Static Files (dist/)  ◄──── Built React App  │
└─────────────────────────────────────────────────────┘
```

### Architecture Goals

1. **Backend** (`server/`): Pure API server, no frontend concerns
2. **Frontend** (`src/` or root): React app consuming API
3. **Shared**: TypeScript types, constants
4. **Deployment**: Single Docker image serving both

### File Structure

```
DevOrbit Dashboard/
├── server/
│   ├── index.js           # Express entry point
│   ├── services/
│   │   ├── configService.js
│   │   ├── settingsService.js  # NEW: User settings persistence
│   │   ├── scannerService.js
│   │   ├── processService.js
│   │   ├── ptyService.js
│   │   ├── PortManager.js
│   │   └── DockerComposeService.js
│   └── db/
│       ├── index.js
│       ├── schema.js
│       └── repositories/
├── components/            # React components
├── hooks/                 # React hooks
├── services/              # Frontend API services
│   ├── api.ts
│   └── geminiService.ts
├── types.ts               # Shared TypeScript types
├── data/                  # Persisted data (gitignored)
│   ├── config.json        # Scan directories config
│   └── settings.json      # User settings (NEW)
└── dist/                  # Built frontend (gitignored)
```

---

## Docker Build Process

### Issue: Docker UI Differs from Dev Server

The Docker container may serve outdated frontend code if:

1. The `dist/` folder wasn't rebuilt before Docker build
2. Docker cache used old layers

### Solution: Multi-stage Build (Already Implemented)

The Dockerfile already uses multi-stage builds:

```dockerfile
# Build stage - always builds fresh frontend
FROM node:20-alpine AS builder
RUN npm run build  # Creates dist/

# Production stage - uses fresh build
FROM node:20-alpine AS production
COPY --from=builder /app/dist ./dist
```

### Build Commands

```bash
# Force fresh build (no cache)
docker compose build --no-cache

# Or rebuild just the frontend before Docker build
bun run build && docker compose build
```

### Docker Compose Volumes

```yaml
volumes:
  # Persistent data directory for settings
  - devorbit-data:/app/data

  # Project directories (read-only)
  - ${HOME}/Projects:/Users/example/Projects:ro
  - ${HOME}/PROJECTS:/Users/example/PROJECTS:ro
```

---

## Remaining Features

### 1. Database Integration (PostgreSQL)

**Status**: Schema ready, connection logic exists, needs activation

**Files**:

- `docker/init-db.sql` - Schema
- `server/db/index.js` - Connection
- `server/db/repositories/applicationsRepository.js` - CRUD

**When to Enable**:

- When file-based storage becomes a bottleneck
- When multi-user support is needed
- When persistent run history is required

### 2. Persistent Terminal Sessions

**Status**: TerminalSessionManager exists, needs WebSocket integration

**Goal**: Terminal sessions persist across browser refreshes

**Implementation**:

1. Store terminal output buffer on server
2. Allow reconnecting to existing sessions
3. Clean up stale sessions automatically

### 3. Full Docker Compose Integration

**Status**: Detection works, needs management UI

**Goal**: Start/stop/manage Docker Compose services from dashboard

**Implementation**:

1. Parse compose files for services
2. Add service management UI in AppDetail
3. Stream logs per service

---

## Implementation Priority (Updated)

| Priority | Feature                          | Status       | Impact                          |
| -------- | -------------------------------- | ------------ | ------------------------------- |
| 1        | **Backend Settings Persistence** | ✅ Completed | Critical - Data loss prevention |
| 2        | **Docker Build Verification**    | ✅ Completed | Critical - Feature parity       |
| 3        | Database Integration             | 🔲 Pending   | Medium - Scalability            |
| 4        | Persistent Terminals             | 🔲 Pending   | Medium - UX improvement         |
| 5        | Docker Compose Management UI     | 🔲 Pending   | Low - Power user feature        |

---

## Quick Start

### Development

```bash
# Install dependencies
bun install

# Start dev server (Vite + Express concurrently)
bun run dev

# Frontend: http://localhost:3000
# Backend:  http://localhost:3099
```

### Production (Docker)

```bash
# Build and start
docker compose up --build -d

# Access at http://localhost:3099

# View logs
docker compose logs -f devorbit
```

### Environment Variables

```bash
# .env.local
GEMINI_API_KEY=your_api_key        # For AI analysis
SERVER_PORT=3099                    # Backend port
DATABASE_URL=postgres://...         # Optional, enables DB
```

---

## Notes

- Settings will be migrated from localStorage to backend on first API call
- Docker volumes ensure settings persist across container restarts
- File-based storage is sufficient for single-user deployment
- Enable PostgreSQL for multi-user or production deployments

---

## NEW FEATURES (from CLAUDE.md) - Not Yet Implemented

These features are defined in CLAUDE.md but have not been implemented yet.

### Updated Implementation Status

| Feature                   | Status     | Priority | Complexity |
| ------------------------- | ---------- | -------- | ---------- |
| Open in External IDE      | 🔲 Pending | High     | Low        |
| Claude Code Terminal      | 🔲 Pending | High     | Medium     |
| Coding Sub-View Layout    | 🔲 Pending | Medium   | Medium     |
| Browser Preview (iframe)  | 🔲 Pending | Medium   | Low        |
| Monaco Editor Integration | 🔲 Pending | Low      | Medium     |
| code-server Integration   | 🔲 Pending | Low      | High       |
| Browser Debugger (CDP)    | 🔲 Pending | Low      | Very High  |

---

## Feature 1: Open in External IDE

**Source**: CLAUDE.md line 60

### Description

Allow users to open a project directly in their preferred IDE (VS Code, Cursor, WebStorm, etc.) from the AppDetail view.

### Implementation

#### Backend Endpoint

```
POST /api/apps/:id/open-ide
Body: { ide: "vscode" | "cursor" | "webstorm" | "intellij" }
```

#### IDE Detection (macOS)

```javascript
const IDE_PATHS = {
  vscode: '/Applications/Visual Studio Code.app',
  cursor: '/Applications/Cursor.app',
  webstorm: '/Applications/WebStorm.app',
  intellij: '/Applications/IntelliJ IDEA.app',
  sublime: '/Applications/Sublime Text.app',
};

// Launch command
exec(`open -a "${idePath}" "${projectPath}"`);
```

#### UI Changes

- Add IDE dropdown button in `AppDetail.tsx` header (next to "Open in Browser")
- Show only detected/installed IDEs
- Remember preferred IDE in settings

#### Files to Modify

| File                                 | Changes                                    |
| ------------------------------------ | ------------------------------------------ |
| `server/index.js`                    | Add `POST /api/apps/:id/open-ide` endpoint |
| `server/services/ideService.js`      | NEW: IDE detection and launch logic        |
| `components/AppDetail.tsx`           | Add IDE selector dropdown                  |
| `server/services/settingsService.js` | Store `preferredIde` setting               |

---

## Feature 2: Claude Code Terminal Tab

**Source**: CLAUDE.md lines 61-64

### Description

Open a terminal tab running Claude Code CLI instead of the default shell, with support for:

- `-c` flag: Continue last session
- `--dangerously-skip-permissions` flag: Skip permission prompts

### Implementation

#### PTY Service Modification

```javascript
// server/services/ptyService.js
function createPtySession(sessionId, cwd, cols, rows, options = {}) {
  const shell = options.command || process.env.SHELL || '/bin/zsh';
  const args = options.args || [];

  // For Claude Code:
  // shell = 'claude'
  // args = ['-c'] or ['--dangerously-skip-permissions']
}
```

#### WebSocket Protocol Extension

```javascript
// New message type for creating Claude terminal
{
  type: 'create-claude',
  cwd: '/path/to/project',
  options: {
    continueSession: true,      // -c flag
    skipPermissions: false      // --dangerously-skip-permissions
  }
}
```

#### UI Components

1. **Claude Code Button**: Next to "Add Terminal" button
2. **Options Modal**: Checkboxes for flags with warning for skip-permissions
3. **Terminal Tab Badge**: Visual indicator that it's a Claude session

#### Security Warning Modal

When `--dangerously-skip-permissions` is selected:

```
⚠️ Warning: Skip Permissions Mode

This mode allows Claude to execute commands without asking
for confirmation. Use only in trusted environments.

[ Cancel ] [ I Understand, Continue ]
```

#### CLI Detection

```bash
# Check if claude is installed
which claude || echo "Claude CLI not found"
```

#### Files to Create/Modify

| File                                 | Changes                                |
| ------------------------------------ | -------------------------------------- |
| `server/services/ptyService.js`      | Accept custom command and args         |
| `server/index.js`                    | WebSocket handler for claude terminals |
| `components/TerminalPanel.tsx`       | Add "Claude Code" button               |
| `components/ClaudeTerminalModal.tsx` | NEW: Options selection modal           |
| `hooks/useTerminal.ts`               | Support for claude terminal type       |

---

## Feature 3: Coding Sub-View (Side-by-Side Developer Workspace)

**Source**: CLAUDE.md lines 65-68

### Description

A dedicated "Coding" view in AppDetail with three resizable panels:

1. **Terminals Panel** - Reuses existing terminal tabs
2. **Web-IDE Panel** - Embedded code editor (Monaco or code-server)
3. **Browser Preview Panel** - iframe showing the running app with debugging tools

### Layout Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│  AppDetail Header (name, status, controls, IDE button)              │
├─────────────────────────────────────────────────────────────────────┤
│  [ Details ]  [ Coding ]  ← View Switcher Tabs                      │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌─────────────┬─────────────────────┬────────────────────────────┐ │
│  │             │                     │                            │ │
│  │  TERMINALS  │      WEB IDE        │    BROWSER PREVIEW         │ │
│  │             │                     │                            │ │
│  │  [Tab1]     │   Monaco Editor     │   ┌──────────────────────┐ │ │
│  │  [Tab2]     │   or                │   │  http://localhost:   │ │ │
│  │  [+Claude]  │   code-server       │   ├──────────────────────┤ │ │
│  │             │   iframe            │   │                      │ │ │
│  │  Terminal   │                     │   │   App Preview        │ │ │
│  │  Output     │   File Explorer     │   │   (iframe)           │ │ │
│  │             │   + Editor          │   │                      │ │ │
│  │             │                     │   ├──────────────────────┤ │ │
│  │             │                     │   │  Console Logs        │ │ │
│  └─────────────┴─────────────────────┴───┴──────────────────────┘ │ │
│       ↔              ↔                 (resizable panels)          │
└─────────────────────────────────────────────────────────────────────┘
```

### Implementation Phases

#### Phase 3.1: Resizable Panel Layout

```bash
bun add react-resizable-panels
```

```tsx
// components/CodingView.tsx
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';

<PanelGroup direction="horizontal">
  <Panel defaultSize={25} minSize={15}>
    <TerminalsPanel />
  </Panel>
  <PanelResizeHandle />
  <Panel defaultSize={40} minSize={20}>
    <WebIDEPanel />
  </Panel>
  <PanelResizeHandle />
  <Panel defaultSize={35} minSize={20}>
    <BrowserPreviewPanel />
  </Panel>
</PanelGroup>;
```

#### Phase 3.2: View Switcher in AppDetail

```tsx
// components/AppDetail.tsx
const [activeView, setActiveView] = useState<'details' | 'coding'>('details');

<div className="flex border-b border-gray-700">
  <button
    className={activeView === 'details' ? 'active' : ''}
    onClick={() => setActiveView('details')}
  >
    Details
  </button>
  <button
    className={activeView === 'coding' ? 'active' : ''}
    onClick={() => setActiveView('coding')}
  >
    Coding
  </button>
</div>;

{
  activeView === 'details' ? <DetailsView /> : <CodingView />;
}
```

#### Files to Create

| File                                            | Purpose                                  |
| ----------------------------------------------- | ---------------------------------------- |
| `components/CodingView.tsx`                     | Main coding layout with resizable panels |
| `components/CodingView/TerminalsPanel.tsx`      | Wrapper for terminal tabs                |
| `components/CodingView/WebIDEPanel.tsx`         | Monaco or code-server embed              |
| `components/CodingView/BrowserPreviewPanel.tsx` | iframe + console logs                    |

---

## Feature 4: Browser Preview Panel

**Source**: CLAUDE.md line 68 ("Browser-View im I-Frame mit Debugger")

### Implementation Phases

#### Phase 4.1: Basic iframe Preview

```tsx
// components/CodingView/BrowserPreviewPanel.tsx
interface BrowserPreviewProps {
  url: string; // e.g., http://localhost:3000
  onRefresh: () => void;
}

<div className="flex flex-col h-full">
  {/* URL Bar */}
  <div className="flex items-center gap-2 p-2 bg-gray-800 border-b">
    <button onClick={onRefresh}>
      <RefreshCw />
    </button>
    <input value={url} readOnly className="flex-1 bg-gray-900 px-2 py-1 rounded" />
    <button onClick={() => window.open(url)}>
      <ExternalLink />
    </button>
  </div>

  {/* Viewport Controls */}
  <div className="flex gap-2 p-2 bg-gray-850">
    <button onClick={() => setViewport('desktop')}>Desktop</button>
    <button onClick={() => setViewport('tablet')}>Tablet</button>
    <button onClick={() => setViewport('mobile')}>Mobile</button>
  </div>

  {/* iframe */}
  <iframe
    src={url}
    className="flex-1 bg-white"
    style={{ width: viewportWidth }}
    sandbox="allow-scripts allow-same-origin allow-forms"
  />
</div>;
```

#### Phase 4.2: Console Log Forwarding

Inject a script into the iframe to capture console logs:

```javascript
// Injected into iframe via postMessage bridge
const originalConsole = { ...console };
['log', 'warn', 'error', 'info'].forEach((method) => {
  console[method] = (...args) => {
    parent.postMessage(
      {
        type: 'console',
        method,
        args: args.map((a) => (typeof a === 'object' ? JSON.stringify(a) : String(a))),
      },
      '*'
    );
    originalConsole[method](...args);
  };
});
```

```tsx
// In BrowserPreviewPanel
useEffect(() => {
  const handler = (e: MessageEvent) => {
    if (e.data.type === 'console') {
      setConsoleLogs((prev) => [...prev, e.data]);
    }
  };
  window.addEventListener('message', handler);
  return () => window.removeEventListener('message', handler);
}, []);
```

#### Phase 4.3: Network Request Logging (Advanced)

Use a Service Worker or proxy to intercept network requests.

#### Viewport Presets

```typescript
const VIEWPORTS = {
  desktop: { width: '100%', label: 'Desktop' },
  tablet: { width: '768px', label: 'Tablet' },
  mobile: { width: '375px', label: 'Mobile' },
};
```

---

## Feature 5: Web-IDE Integration

**Source**: CLAUDE.md line 67 ("Web-IDE (VS-Code) einbauen")

### Options Evaluated

| Option               | Description                | Pros                       | Cons                             | Recommendation      |
| -------------------- | -------------------------- | -------------------------- | -------------------------------- | ------------------- |
| **Monaco Editor**    | VS Code's editor component | Lightweight, easy to embed | No file explorer, no extensions  | Phase 1             |
| **code-server**      | Full VS Code in browser    | Complete IDE experience    | Heavy, requires separate process | Phase 2             |
| **External VS Code** | Just open in desktop app   | Simple, full features      | Not embedded                     | Already implemented |

### Phase 5.1: Monaco Editor Integration

```bash
bun add @monaco-editor/react
```

```tsx
// components/CodingView/MonacoPanel.tsx
import Editor from '@monaco-editor/react';

interface MonacoPanelProps {
  projectPath: string;
  initialFile?: string;
}

function MonacoPanel({ projectPath, initialFile }: MonacoPanelProps) {
  const [files, setFiles] = useState<FileTree>([]);
  const [currentFile, setCurrentFile] = useState(initialFile);
  const [content, setContent] = useState('');

  // Load file tree via API
  useEffect(() => {
    fetch(`/api/apps/${appId}/files`)
      .then((r) => r.json())
      .then(setFiles);
  }, []);

  return (
    <div className="flex h-full">
      {/* File Explorer */}
      <div className="w-48 border-r border-gray-700 overflow-auto">
        <FileTree files={files} onSelect={setCurrentFile} />
      </div>

      {/* Editor */}
      <div className="flex-1">
        <Editor
          theme="vs-dark"
          path={currentFile}
          value={content}
          onChange={setContent}
          language={detectLanguage(currentFile)}
        />
      </div>
    </div>
  );
}
```

#### Backend API for File Operations

```
GET  /api/apps/:id/files           - List files (tree structure)
GET  /api/apps/:id/files/*path     - Read file content
PUT  /api/apps/:id/files/*path     - Write file content
```

### Phase 5.2: code-server Integration (Advanced)

Requires running code-server as a separate service:

```yaml
# docker-compose.yml addition
services:
  code-server:
    image: codercom/code-server:latest
    ports:
      - '8443:8080'
    volumes:
      - ${HOME}/Projects:/home/coder/projects
    environment:
      - PASSWORD=devOrbit123
```

Then embed via iframe:

```tsx
<iframe src="http://localhost:8443/?folder=/home/coder/projects/${projectName}" />
```

---

## Implementation Timeline

### Phase 1: Quick Wins (1-2 days)

- [ ] Open in External IDE endpoint + UI
- [ ] Basic Browser Preview (iframe + refresh + viewport)

### Phase 2: Claude Code Integration (2-3 days)

- [ ] PTY service modification for custom commands
- [ ] Claude terminal button + options modal
- [ ] CLI detection and error handling

### Phase 3: Coding Layout (3-5 days)

- [ ] Install react-resizable-panels
- [ ] Create CodingView with 3-panel layout
- [ ] Details/Coding view switcher
- [ ] Panel size persistence

### Phase 4: Editor & Debugging (5-10 days)

- [ ] Monaco Editor integration
- [ ] File tree API endpoints
- [ ] Console log forwarding
- [ ] Network request logging (optional)

### Phase 5: Advanced (Future)

- [ ] code-server Docker integration
- [ ] Chrome DevTools Protocol debugging
- [ ] Breakpoint support

---

## New Dependencies

```json
{
  "dependencies": {
    "react-resizable-panels": "^2.0.0",
    "@monaco-editor/react": "^4.6.0"
  }
}
```

---

## File Structure After Implementation

```
components/
├── AppDetail.tsx              # Updated with view switcher
├── CodingView/
│   ├── index.tsx              # Main 3-panel layout
│   ├── TerminalsPanel.tsx     # Terminal tabs wrapper
│   ├── WebIDEPanel.tsx        # Monaco or code-server
│   ├── BrowserPreviewPanel.tsx # iframe + console
│   └── FileTree.tsx           # File explorer for Monaco
├── ClaudeTerminalModal.tsx    # Claude options modal
└── IDESelector.tsx            # IDE dropdown component

server/
├── services/
│   ├── ideService.js          # NEW: IDE detection/launch
│   └── fileService.js         # NEW: File read/write for Monaco
└── index.js                   # New endpoints
```
