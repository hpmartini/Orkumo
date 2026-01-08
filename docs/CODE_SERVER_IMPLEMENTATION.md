# Code Server Implementation Summary

## Overview

DevOrbit Dashboard has **full code-server integration** already implemented and production-ready. This document provides a comprehensive overview of the implementation.

## Architecture

### Frontend Components

#### CodingView (`components/CodingView/index.tsx`)
- Split-pane layout using `react-resizable-panels`
- Three panels: Terminals | Web IDE | Browser Preview
- Responsive design with adjustable panel sizes
- Terminal session preservation

#### WebIDEPanel (`components/CodingView/WebIDEPanel.tsx`)
- **Dual Editor Support**:
  - **Monaco Editor**: Lightweight (~300KB), instant load, basic editing
  - **code-server**: Full VS Code experience with extensions, debugging, git
- **Editor Switcher**: Toggle between Monaco and code-server in UI
- **Features**:
  - File tree explorer with expand/collapse
  - Multiple open files with tabs
  - Save functionality with modified state tracking
  - Syntax highlighting (Monaco) and language detection
  - Security: Path traversal prevention, iframe sandboxing

#### Path Mapping
```javascript
Host Path:      /Users/you/Projects/myapp
Container Path: /home/coder/Projects/myapp
```
- Automatic path translation for Docker environment
- Handles both `Projects` and `PROJECTS` directories
- Validation to prevent path traversal attacks

### Backend Services

#### File Operations API (`server/index.js`)

**GET `/api/files/tree`**
- Returns file tree structure for a directory
- Parameters: `path` (required), `depth` (optional, default: 3)
- Excludes: `node_modules`, `.git`, common build directories
- Response: Nested file/directory structure

**GET `/api/files/read`**
- Reads file content
- Parameters: `path` (required)
- Returns: File content + detected language
- Security: Path validation, file size limits

**PUT `/api/files/write`**
- Writes content to file
- Body: `{ path, content }`
- Security: Path validation, creates directories if needed

### Docker Infrastructure

#### code-server Container (`docker-compose.yml`)

```yaml
services:
  code-server:
    image: codercom/code-server:latest
    ports:
      - "8443:8080"
    volumes:
      - ${HOME}/Projects:/home/coder/Projects
      - ${HOME}/PROJECTS:/home/coder/PROJECTS
      - code-server-config:/home/coder/.config
    environment:
      - PASSWORD=${CODE_SERVER_PASSWORD}
      - SUDO_PASSWORD=${CODE_SERVER_SUDO_PASSWORD:-}
    deploy:
      resources:
        limits:
          cpus: '2.0'
          memory: 2G
```

**Features**:
- Persistent configuration storage
- Resource limits to prevent DoS
- Health checks with automatic restart
- Shared network with API container

## Security Implementation

### Authentication
- **Password Protection**: Required via `CODE_SERVER_PASSWORD` env var
- **Strength Requirements**: 12+ chars, mixed case, numbers, symbols
- **Validation Script**: `scripts/validate-code-server-password.sh`
- **Optional Sudo**: Can disable sudo access via empty `CODE_SERVER_SUDO_PASSWORD`

### Network Security
- **Default**: localhost-only (port 8443)
- **HTTPS Support**: Via reverse proxy (Caddy, Nginx, Cloudflare Tunnel)
- **Recommended Remote Access**: SSH tunnel or VPN

### Frontend Security
- **Iframe Sandboxing**: `sandbox="allow-scripts allow-forms allow-popups allow-downloads allow-modals"`
- **Path Validation**: Prevents directory traversal attacks
- **Allowed Prefixes**: Only permits access to configured directories
- **CORS Protection**: Isolated iframe origin

### Backend Security
- **Rate Limiting**: 100 requests/min general, 20/min process ops
- **Input Validation**: Zod schemas for all API inputs
- **Path Sanitization**: Blocks `..` and validates allowed prefixes
- **File Size Limits**: Prevents DoS via large files

## Configuration

### Environment Variables

**Required**:
```bash
CODE_SERVER_PASSWORD=your_secure_password_here
```

**Optional**:
```bash
# code-server URL (default: http://localhost:8443)
VITE_CODE_SERVER_URL=http://localhost:8443

# Iframe load timeout in ms (default: 15000)
VITE_CODE_SERVER_TIMEOUT=15000

# Disable sudo access (recommended)
CODE_SERVER_SUDO_PASSWORD=
```

### Volume Mounts
- Projects directory: `${HOME}/Projects` → `/home/coder/Projects`
- Alternative: `${HOME}/PROJECTS` → `/home/coder/PROJECTS`
- Config storage: `code-server-config` volume

## User Workflow

### 1. Setup
```bash
# Set password in .env
CODE_SERVER_PASSWORD=SecurePass123!@#

# Start code-server
docker compose up code-server -d
```

### 2. Access from Dashboard
1. Navigate to project detail view
2. Click "Coding View" tab
3. In Web IDE panel, click editor type switcher
4. Select "VS Code" button
5. Wait for code-server to load (~2-3 seconds)
6. Enter password when prompted
7. Start coding with full VS Code features!

### 3. Editor Comparison

| Feature | Monaco Editor | code-server |
|---------|---------------|-------------|
| Load Time | Instant | 2-3 seconds |
| Memory | ~50MB | ~200-500MB |
| Extensions | ❌ | ✅ Full marketplace |
| Terminal | ❌ | ✅ Integrated |
| Git UI | ❌ | ✅ GitLens, etc. |
| Debugging | ❌ | ✅ Full support |
| Settings Sync | ❌ | ✅ Via VS Code account |
| **Best For** | Quick edits | Full development |

## Troubleshooting

### code-server Won't Start
**Error**: `CODE_SERVER_PASSWORD must be set`

**Fix**: Set password in `.env` file

### Timeout Errors
**Symptoms**: "Failed to load VS Code (timeout)"

**Fixes**:
1. Verify container is running: `docker compose ps code-server`
2. Check logs: `docker compose logs -f code-server`
3. Increase timeout: `VITE_CODE_SERVER_TIMEOUT=30000`
4. Check firewall settings

### Wrong Files Visible
**Symptoms**: Can't see project files

**Fix**: Check path mapping in browser console (F12):
```
[WebIDEPanel] Mapped path: /Users/you/Projects/myapp -> /home/coder/Projects/myapp
```

If incorrect, update volume mounts in `docker-compose.yml`

### Permission Errors
**Symptoms**: "Permission denied" when editing

**Fix**: Ensure correct permissions:
```bash
chmod -R u+rw ~/Projects
```

## Advanced Configuration

### HTTPS Setup (Production)

#### Option 1: Caddy (Recommended)
```bash
# Caddyfile
code.yourdomain.com {
    reverse_proxy localhost:8443
}

# .env
VITE_CODE_SERVER_URL=https://code.yourdomain.com
```

#### Option 2: Nginx + Certbot
```nginx
server {
    listen 443 ssl;
    server_name code.yourdomain.com;

    location / {
        proxy_pass http://localhost:8443;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection upgrade;
    }
}
```

#### Option 3: SSH Tunnel (Zero Setup)
```bash
ssh -L 8443:localhost:8443 user@your-server
# Access via http://localhost:8443
```

### Custom Resource Limits

Edit `docker-compose.yml`:
```yaml
deploy:
  resources:
    limits:
      cpus: '4.0'      # Increase for large projects
      memory: 4G
```

### Extension Pre-installation

Create custom Dockerfile:
```dockerfile
FROM codercom/code-server:latest
RUN code-server --install-extension dbaeumer.vscode-eslint
RUN code-server --install-extension esbenp.prettier-vscode
```

Update `docker-compose.yml`:
```yaml
code-server:
  build:
    context: ./docker/code-server
    dockerfile: Dockerfile
```

## Future Enhancement Ideas

### 1. Multi-instance Support
- Spawn separate code-server instances per project
- Dynamic port allocation
- Instance lifecycle management

### 2. Extension Management UI
- Browse and install extensions from dashboard
- Pre-configured extension sets per project type
- Extension sync across instances

### 3. Workspace Templates
- React/TypeScript workspace
- Node.js backend workspace
- Full-stack workspace
- Python/Data Science workspace

### 4. Session Persistence
- Remember open files per project
- Restore editor state (cursor position, scroll)
- Persist workspace settings

### 5. Auto-start
- Automatically start code-server when opening coding view
- Lazy initialization for resource efficiency
- Background warmup for faster access

### 6. Performance Monitoring
- Track code-server resource usage
- Display in project details
- Alert on excessive resource consumption

## Comparison with Research Recommendations

The implementation follows the research recommendations:

✅ **code-server chosen** (as recommended over OpenVSCode Server)
✅ **Docker-based deployment** (matches implementation plan)
✅ **Password authentication** (as specified)
✅ **Resource limits configured** (2 CPU, 2GB RAM)
✅ **Security best practices** (password requirements, HTTPS guidance)
✅ **Dual editor support** (Monaco for quick edits, code-server for full IDE)
✅ **Comprehensive documentation** (setup, troubleshooting, security)

## Conclusion

The code-server integration is **production-ready** and follows industry best practices. The implementation includes:

- ✅ Full VS Code experience in browser
- ✅ Secure authentication and sandboxing
- ✅ Comprehensive documentation
- ✅ Docker containerization
- ✅ Resource management
- ✅ HTTPS support
- ✅ Troubleshooting guides

No additional implementation work is required unless optional enhancements are desired.
