# DevOrbit Dashboard - Implementation Plan

This document outlines the planned features and their implementation details for future development.

---

## 1. Persistent Terminal Sessions (Backend)

**Goal**: Terminal sessions should persist across browser refreshes, with history stored on the backend.

### Architecture

```
┌─────────────────┐     WebSocket      ┌──────────────────┐     PTY      ┌─────────┐
│   Browser UI    │ ◄────────────────► │  Terminal Server │ ◄──────────► │  Shell  │
│   (xterm.js)    │                    │  (Node.js/WS)    │              │ (bash)  │
└─────────────────┘                    └────────┬─────────┘              └─────────┘
                                                │
                                                ▼
                                       ┌──────────────────┐
                                       │  Session Store   │
                                       │  (Redis/SQLite)  │
                                       └──────────────────┘
```

### Implementation Steps

1. **Session Management Service**
   - Create `server/services/TerminalSessionManager.js`
   - Store sessions with: `sessionId`, `pid`, `cwd`, `createdAt`, `lastActivity`
   - Implement session recovery on WebSocket reconnect
   - Add session timeout/cleanup mechanism

2. **Output Buffer**
   - Store last N lines (configurable, default 10,000) of terminal output per session
   - Use circular buffer for memory efficiency
   - Persist to database on intervals and session close

3. **Database Schema**
   ```sql
   CREATE TABLE terminal_sessions (
     id TEXT PRIMARY KEY,
     app_id TEXT,
     cwd TEXT,
     shell TEXT,
     created_at TIMESTAMP,
     last_activity TIMESTAMP,
     is_active BOOLEAN
   );

   CREATE TABLE terminal_history (
     id INTEGER PRIMARY KEY,
     session_id TEXT REFERENCES terminal_sessions(id),
     output TEXT,
     timestamp TIMESTAMP
   );
   ```

4. **Frontend Changes**
   - Add session recovery UI (list previous sessions)
   - Show session age and status
   - "Reconnect" vs "New Session" options

### Estimated Effort
- Backend: 3-4 days
- Frontend: 1-2 days
- Testing: 1 day

---

## 2. Docker Compose Deployment

**Goal**: Package the entire DevOrbit stack in Docker for easy deployment.

### Docker Architecture

```yaml
# docker-compose.yml structure
services:
  devorbit-api:        # Node.js API server + WebSocket
  devorbit-web:        # Vite/React frontend (or served by API)
  devorbit-db:         # PostgreSQL/SQLite for app data
  redis:               # Session store, caching (optional)
```

### Implementation Steps

1. **Create Dockerfiles**

   `Dockerfile.api`:
   ```dockerfile
   FROM node:20-alpine
   WORKDIR /app

   # node-pty requires build tools
   RUN apk add --no-cache python3 make g++

   COPY package*.json ./
   RUN npm ci --only=production

   COPY server/ ./server/
   COPY dist/ ./dist/  # Pre-built frontend

   EXPOSE 3099
   CMD ["node", "server/index.js"]
   ```

2. **Create docker-compose.yml**
   ```yaml
   version: '3.8'

   services:
     devorbit:
       build:
         context: .
         dockerfile: Dockerfile
       ports:
         - "3099:3099"
       volumes:
         - /var/run/docker.sock:/var/run/docker.sock  # For Docker management
         - ${SCAN_DIR:-/home/user/projects}:/projects:ro
         - devorbit-data:/app/data
       environment:
         - NODE_ENV=production
         - DATABASE_URL=postgres://postgres:postgres@db:5432/devorbit
         - REDIS_URL=redis://redis:6379
       depends_on:
         - db
         - redis

     db:
       image: postgres:16-alpine
       volumes:
         - postgres-data:/var/lib/postgresql/data
       environment:
         - POSTGRES_DB=devorbit
         - POSTGRES_PASSWORD=postgres

     redis:
       image: redis:7-alpine
       volumes:
         - redis-data:/data

   volumes:
     devorbit-data:
     postgres-data:
     redis-data:
   ```

3. **Volume Mounts for Development**
   - Mount host project directories (read-only for scanning)
   - Mount Docker socket for container management
   - Persistent volumes for database

4. **Production Considerations**
   - Multi-stage builds for smaller images
   - Health checks
   - Resource limits
   - Log aggregation

### Estimated Effort
- Dockerfiles: 1 day
- docker-compose: 1 day
- Testing & debugging: 2 days
- Documentation: 0.5 day

---

## 3. Database for App Information

**Goal**: Store discovered app information persistently in a database.

### Database Selection: **PostgreSQL** (with SQLite fallback)

**Rationale**:
- PostgreSQL: Best for Docker deployment, robust, supports JSONB for flexible metadata
- SQLite: Lightweight fallback for single-user/development

### Schema Design

```sql
-- Applications table
CREATE TABLE applications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  path TEXT NOT NULL UNIQUE,
  type VARCHAR(50),  -- 'node', 'python', 'docker', etc.
  framework VARCHAR(100),  -- 'nextjs', 'vite', 'flask', etc.

  -- Configuration
  start_command TEXT,
  default_port INTEGER,
  custom_port INTEGER,
  env_file TEXT,

  -- User preferences
  is_favorite BOOLEAN DEFAULT FALSE,
  is_archived BOOLEAN DEFAULT FALSE,
  display_order INTEGER,

  -- Metadata
  package_json JSONB,
  detected_scripts JSONB,

  -- Timestamps
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  last_started_at TIMESTAMP,
  last_scanned_at TIMESTAMP
);

-- Application runs/history
CREATE TABLE app_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id UUID REFERENCES applications(id) ON DELETE CASCADE,

  status VARCHAR(50),  -- 'running', 'stopped', 'error', 'crashed'
  pid INTEGER,
  port INTEGER,

  started_at TIMESTAMP DEFAULT NOW(),
  stopped_at TIMESTAMP,
  exit_code INTEGER,

  -- Resource usage snapshots
  cpu_usage DECIMAL(5,2),
  memory_mb INTEGER
);

-- Port allocations (for conflict management)
CREATE TABLE port_allocations (
  port INTEGER PRIMARY KEY,
  app_id UUID REFERENCES applications(id) ON DELETE SET NULL,
  allocated_at TIMESTAMP DEFAULT NOW(),
  is_system_port BOOLEAN DEFAULT FALSE
);

-- Tags for organization
CREATE TABLE tags (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) UNIQUE NOT NULL,
  color VARCHAR(7)  -- hex color
);

CREATE TABLE app_tags (
  app_id UUID REFERENCES applications(id) ON DELETE CASCADE,
  tag_id INTEGER REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (app_id, tag_id)
);

-- Indexes
CREATE INDEX idx_apps_path ON applications(path);
CREATE INDEX idx_apps_favorite ON applications(is_favorite);
CREATE INDEX idx_app_runs_app_id ON app_runs(app_id);
CREATE INDEX idx_app_runs_status ON app_runs(status);
```

### Implementation Steps

1. **Database Layer**
   - Create `server/db/` directory
   - Use Drizzle ORM or Prisma for type-safe queries
   - Create migration system

2. **API Changes**
   - Modify `/api/apps` to read from database
   - Add scan endpoint that updates database
   - Add CRUD endpoints for preferences

3. **Sync Strategy**
   - On startup: scan filesystem, update database
   - Detect removed apps (mark as deleted, don't hard delete)
   - Periodic rescan option

### Estimated Effort
- Schema & migrations: 1 day
- ORM setup: 0.5 day
- API refactoring: 2 days
- Testing: 1 day

---

## 4. Browser-Style Tabs for Running Apps

**Goal**: Display running applications as browser-like tabs at the top of the content area.

### UI Design

```
┌──────────────────────────────────────────────────────────────────────────┐
│ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐                    [+]   │
│ │ 🟢 my-app   │ │ 🟢 api-svc  │ │ 🟡 frontend │                          │
│ │     × │ │     × │ │     × │                          │
│ └─────────────┘ └─────────────┘ └─────────────┘                          │
├──────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│                         [App Content Area]                               │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

### Implementation Steps

1. **Create AppTabs Component**
   ```typescript
   // components/AppTabs.tsx
   interface AppTab {
     appId: string;
     name: string;
     status: AppStatus;
     port?: number;
   }

   interface AppTabsProps {
     tabs: AppTab[];
     activeTabId: string | null;
     onSelectTab: (id: string) => void;
     onCloseTab: (id: string) => void;
     onReorderTabs: (fromIndex: number, toIndex: number) => void;
   }
   ```

2. **Features**
   - Drag-and-drop reordering (use `@dnd-kit/core`)
   - Close button (X) on each tab
   - Status indicator (running/starting/error)
   - Right-click context menu
   - Tab overflow handling (scroll or dropdown)
   - Keyboard navigation (Ctrl+Tab, Ctrl+W)

3. **State Management**
   - Track open tabs separately from running apps
   - Persist tab order in localStorage
   - Auto-open tab when app starts
   - Option to keep tab open when app stops

4. **Layout Changes**
   - Move tabs above content area in `App.tsx`
   - Adjust responsive behavior for mobile

### Estimated Effort
- Component: 2 days
- Drag-and-drop: 1 day
- Integration: 1 day
- Polish: 0.5 day

---

## 5. Kebab Menu for Dashboard App Items

**Goal**: Add a kebab (three-dot) menu to each app item on the dashboard with common actions.

### UI Design

```
┌─────────────────────────────────────────────────┐
│  🟢 my-nextjs-app                          [⋮]  │
│     Next.js • Port 3000                         │
│                        ┌─────────────────────┐  │
│                        │ ⭐ Favorite         │  │
│                        │ 📦 Archive          │  │
│                        │ ─────────────────── │  │
│                        │ ▶️  Start           │  │
│                        │ ⏹️  Stop            │  │
│                        │ 🔄 Restart          │  │
│                        │ ─────────────────── │  │
│                        │ 🌐 Open in Browser  │  │
│                        │ 📂 Open in Finder   │  │
│                        │ 💻 Open in Terminal │  │
│                        └─────────────────────┘  │
└─────────────────────────────────────────────────┘
```

### Implementation Steps

1. **Create KebabMenu Component**
   ```typescript
   // components/KebabMenu.tsx
   interface MenuItem {
     label: string;
     icon: LucideIcon;
     onClick: () => void;
     disabled?: boolean;
     variant?: 'default' | 'danger';
     divider?: boolean;
   }

   interface KebabMenuProps {
     items: MenuItem[];
     position?: 'left' | 'right';
   }
   ```

2. **Menu Items**
   - Favorite / Unfavorite (toggle)
   - Archive / Unarchive (toggle)
   - Divider
   - Start (disabled when running)
   - Stop (disabled when stopped)
   - Restart (disabled when stopped)
   - Divider
   - Open in Browser (disabled when no port)
   - Open in Finder/Explorer
   - Open in Terminal
   - Divider
   - Delete from list (with confirmation)

3. **Behavior**
   - Click outside to close
   - Keyboard navigation (arrow keys, Enter, Escape)
   - Position aware (flip if near edge)
   - Prevent event propagation to card click

4. **Integration**
   - Add to `AppList.tsx` items
   - Add to `Sidebar.tsx` (optional)

### Estimated Effort
- Component: 1 day
- Integration: 0.5 day
- Accessibility: 0.5 day

---

## 6. Auto-Fix Port Conflicts

**Goal**: Automatically detect and resolve port conflicts when starting applications.

### Detection Strategy

```
1. Before starting app:
   ├─ Check if configured port is in use
   │   ├─ If free → use configured port
   │   └─ If busy → identify who's using it
   │       ├─ Another DevOrbit app → offer to stop it
   │       ├─ System process → suggest alternative port
   │       └─ Unknown → suggest alternative port
   │
   └─ Find next available port in range
```

### Implementation Steps

1. **Port Scanner Service**
   ```javascript
   // server/services/PortManager.js
   class PortManager {
     async isPortAvailable(port) { }
     async findAvailablePort(startPort, endPort) { }
     async getProcessOnPort(port) { }
     async allocatePort(appId, preferredPort) { }
     async releasePort(appId) { }
   }
   ```

2. **Conflict Resolution UI**
   ```typescript
   // When port conflict detected, show modal:
   interface PortConflictModalProps {
     requestedPort: number;
     conflictingProcess: {
       name: string;
       pid: number;
       isDevOrbitApp: boolean;
       appId?: string;
     };
     suggestedPort: number;
     onUseAlternate: (port: number) => void;
     onKillProcess: () => void;
     onCancel: () => void;
   }
   ```

3. **Auto-Resolution Options**
   - **User Setting**: "Auto-assign available port on conflict"
   - **Port Range**: Configure port range per app type (e.g., 3000-3999 for Node)
   - **Port Memory**: Remember last used port per app

4. **API Endpoints**
   ```
   GET  /api/ports/check/:port     - Check if port is available
   GET  /api/ports/available       - Get next available port
   POST /api/ports/kill/:port      - Kill process on port (with confirmation)
   ```

5. **Integration**
   - Before `startApp()`, check port availability
   - If conflict, either auto-resolve or show modal
   - Update app config with actual port used

### Estimated Effort
- Port scanner: 1 day
- Conflict resolution UI: 1 day
- Integration: 1 day
- Testing: 0.5 day

---

## 7. Docker Compose Application Detection & Management

**Goal**: Detect, configure, and manage Docker Compose projects.

### Detection Logic

```javascript
// Detect Docker Compose projects by looking for:
const COMPOSE_FILES = [
  'docker-compose.yml',
  'docker-compose.yaml',
  'compose.yml',
  'compose.yaml',
  'docker-compose.dev.yml',
  'docker-compose.override.yml'
];

// Parse compose file to extract:
// - Service names
// - Exposed ports
// - Volume mounts
// - Dependencies
// - Health checks
```

### App Type Extension

```typescript
interface DockerComposeApp extends AppConfig {
  type: 'docker-compose';
  composeFile: string;
  services: DockerService[];
  profiles?: string[];
}

interface DockerService {
  name: string;
  image?: string;
  build?: string;
  ports: PortMapping[];
  status: 'running' | 'stopped' | 'starting' | 'error';
  containerId?: string;
  health?: 'healthy' | 'unhealthy' | 'starting';
}
```

### Implementation Steps

1. **Docker Compose Parser**
   ```javascript
   // server/services/DockerComposeParser.js
   class DockerComposeParser {
     async parse(filePath) { }
     async getServices(filePath) { }
     async getPortMappings(filePath) { }
   }
   ```

2. **Docker Integration**
   ```javascript
   // server/services/DockerManager.js
   class DockerManager {
     async composeUp(path, options) { }
     async composeDown(path) { }
     async composeLogs(path, service) { }
     async composePs(path) { }
     async getContainerStats(containerId) { }
   }
   ```

3. **Commands**
   - Start: `docker compose up -d`
   - Stop: `docker compose down`
   - Restart: `docker compose restart`
   - Logs: `docker compose logs -f [service]`
   - Build: `docker compose build`

4. **UI Components**
   - Show services as expandable section in AppDetail
   - Individual service start/stop
   - Log viewer per service
   - Container stats (CPU, memory, network)

5. **Special Handling**
   - Multiple compose files (merge behavior)
   - Profiles support
   - Environment file selection
   - Build vs pull options

### Estimated Effort
- Parser: 1 day
- Docker integration: 2 days
- UI components: 2 days
- Testing: 1 day

---

## Implementation Priority

| Priority | Feature | Effort | Impact |
|----------|---------|--------|--------|
| 1 | Kebab Menu | 2 days | High - UX improvement |
| 2 | Port Conflict Auto-Fix | 3.5 days | High - Major pain point |
| 3 | Browser-Style Tabs | 4.5 days | High - UX improvement |
| 4 | Docker Compose Detection | 6 days | High - Major feature |
| 5 | Database Integration | 4.5 days | Medium - Scalability |
| 6 | Persistent Terminals | 6 days | Medium - Power user feature |
| 7 | Docker Deployment | 4.5 days | Medium - Deployment ease |

**Total Estimated Effort**: ~31 days

---

## Tech Stack Additions

| Feature | New Dependencies |
|---------|-----------------|
| Database | `pg`, `drizzle-orm` or `prisma` |
| Tabs DnD | `@dnd-kit/core`, `@dnd-kit/sortable` |
| Docker | `dockerode` |
| YAML Parse | `js-yaml` |
| Port Scan | `portfinder`, `find-process` |

---

## Notes

- All estimates assume single developer
- Add 20-30% buffer for edge cases and testing
- Features can be developed in parallel where dependencies allow
- Consider feature flags for gradual rollout
