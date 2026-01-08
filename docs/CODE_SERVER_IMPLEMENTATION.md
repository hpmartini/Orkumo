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

### Network Architecture

DevOrbit uses nginx as a reverse proxy to route traffic to code-server:

```
Browser Request Flow:
1. User accesses: http://localhost:3000/code-server/
2. Request hits nginx (frontend container)
3. Nginx proxies to: code-server:8080 (internal Docker network)
4. code-server responds through nginx back to browser
```

**Key Points**:
- code-server is accessed at `/code-server/` path (not direct port access)
- All traffic goes through nginx reverse proxy
- Internal Docker network communication only (`devorbit-network`)
- Port 8443 exposed to host for optional direct access (debugging)

**Configuration**:
- Frontend: `VITE_CODE_SERVER_URL=/code-server/` (relative path)
- Nginx: `location /code-server/` proxy to `code-server:8080`
- Docker: code-server container on internal network

### Network Security
- **Default**: localhost-only through nginx proxy
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

**How to check**:
```bash
# Verify code-server container status
docker compose ps code-server

# Check container logs for startup errors
docker compose logs code-server
```

### Connection Refused / Timeout Errors

**Symptoms**: "Failed to load VS Code (timeout)" or "connection refused"

**Fixes**:

1. **Verify container is running**:
   ```bash
   docker compose ps code-server
   # Should show "running" status
   ```

2. **Check container logs**:
   ```bash
   docker compose logs -f code-server
   # Look for startup errors or crashes
   ```

3. **Verify nginx proxy is working**:
   ```bash
   # Test nginx proxy (from host machine)
   curl -I http://localhost:3000/code-server/
   # Should return 200 OK or redirect to login
   ```

4. **Check if code-server is accessible directly** (debugging only):
   ```bash
   # Should work on host machine
   curl -I http://localhost:8443/
   ```

5. **Increase timeout** if container is slow to start:
   ```bash
   # In .env file
   VITE_CODE_SERVER_TIMEOUT=30000
   ```

6. **Check firewall settings** (if using direct port access):
   ```bash
   # macOS
   sudo /usr/libexec/ApplicationFirewall/socketfilterfw --listapps

   # Linux
   sudo ufw status
   ```

7. **Restart services**:
   ```bash
   docker compose restart frontend code-server
   ```

### Wrong Files Visible

**Symptoms**: Can't see project files or wrong directory opens

**Fix**: Check path mapping in browser console (F12 → Console):
```
[WebIDEPanel] Mapped path: /Users/you/Projects/myapp -> /home/coder/Projects/myapp
```

If path doesn't match expected:

1. **Verify volume mounts** in `docker-compose.yml`:
   ```yaml
   volumes:
     - ${HOME}/Projects:/home/coder/Projects
     - ${HOME}/PROJECTS:/home/coder/PROJECTS
   ```

2. **Check your project path**:
   ```bash
   # Your project should be in one of these directories
   ls ~/Projects
   ls ~/PROJECTS
   ```

3. **Restart code-server after changing mounts**:
   ```bash
   docker compose down code-server
   docker compose up -d code-server
   ```

### Permission Errors

**Symptoms**: "Permission denied" when editing files

**Fixes**:

1. **Ensure host directories have correct permissions**:
   ```bash
   chmod -R u+rw ~/Projects
   ```

2. **Check file ownership**:
   ```bash
   ls -la ~/Projects/your-project
   # Files should be owned by your user
   ```

3. **Fix ownership if needed**:
   ```bash
   sudo chown -R $USER:$USER ~/Projects
   ```

### Authentication Not Working

**Symptoms**: code-server keeps asking for password or won't accept password

**Fixes**:

1. **Verify password is set correctly**:
   ```bash
   # Check .env file has CODE_SERVER_PASSWORD set
   grep CODE_SERVER_PASSWORD .env
   ```

2. **Check for special characters** that might need escaping:
   ```bash
   # Avoid characters like $, `, ", ', \ in passwords
   # Or ensure they're properly escaped
   ```

3. **Clear browser cookies**:
   - Open DevTools (F12)
   - Application tab → Cookies → Clear cookies for localhost
   - Refresh page

4. **Restart code-server**:
   ```bash
   docker compose restart code-server
   ```

### WebSocket Connection Failures

**Symptoms**: Terminal not working in VS Code, or "WebSocket connection failed" errors

**Fixes**:

1. **Verify nginx WebSocket proxy is configured** (should be in `docker/nginx.conf`):
   ```nginx
   proxy_set_header Upgrade $http_upgrade;
   proxy_set_header Connection $connection_upgrade;
   ```

2. **Check browser console** (F12) for WebSocket errors

3. **Verify code-server healthcheck passes**:
   ```bash
   docker compose ps code-server
   # Health status should be "healthy"
   ```

4. **Test WebSocket upgrade manually**:
   ```bash
   curl -i -N -H "Connection: Upgrade" -H "Upgrade: websocket" \
     http://localhost:3000/code-server/
   ```

### High Resource Usage

**Symptoms**: code-server using excessive CPU or memory

**Fixes**:

1. **Check current resource usage**:
   ```bash
   docker stats devorbit-code-server
   ```

2. **Adjust resource limits** in `docker-compose.yml`:
   ```yaml
   deploy:
     resources:
       limits:
         cpus: '1.0'      # Reduce from 2.0
         memory: 1G       # Reduce from 2G
   ```

3. **Close unused VS Code tabs/windows**

4. **Disable resource-heavy extensions**

5. **Restart code-server**:
   ```bash
   docker compose restart code-server
   ```

### Port Already in Use

**Error**: `Bind for 127.0.0.1:8443 failed: port is already allocated`

**Fixes**:

1. **Find what's using the port**:
   ```bash
   # macOS/Linux
   lsof -i :8443

   # Or use netstat
   netstat -an | grep 8443
   ```

2. **Change the port** in `docker-compose.yml`:
   ```yaml
   ports:
     - "127.0.0.1:8444:8080"  # Changed from 8443
   ```

3. **Update environment variable** (if using direct access):
   ```bash
   # .env file
   VITE_CODE_SERVER_URL=http://localhost:8444
   ```

4. **Restart services**:
   ```bash
   docker compose down
   docker compose up -d
   ```

### Extensions Won't Install

**Symptoms**: Can't install VS Code extensions from marketplace

**Fixes**:

1. **Check internet connectivity** from container:
   ```bash
   docker exec devorbit-code-server curl -I https://marketplace.visualstudio.com
   ```

2. **Verify extension marketplace URL** is accessible

3. **Try manual installation**:
   - Download `.vsix` file from marketplace
   - In VS Code: Extensions → "..." menu → "Install from VSIX"

4. **Check container logs** for errors:
   ```bash
   docker compose logs -f code-server | grep -i extension
   ```

## Advanced Configuration

### HTTPS Setup (Production)

> **⚠️ IMPORTANT:** When deploying with HTTPS, ensure your reverse proxy properly handles WebSocket upgrades. code-server requires WebSocket support for terminal functionality, file watching, and real-time features.

**Why HTTPS is Important:**
- Passwords and code transmitted in plaintext over HTTP
- Cookies marked as `Secure` won't work over HTTP
- Modern browsers restrict features on non-HTTPS sites
- Required for remote access from any location

**Key Considerations:**
1. **WebSocket Protocol Change**: When using HTTPS, WebSocket connections use `wss://` instead of `ws://`
2. **Nginx Proxy Requirements**:
   - Must forward `Upgrade` and `Connection` headers
   - Must use `proxy_http_version 1.1` (WebSocket requires HTTP/1.1)
   - Buffering must be disabled for real-time communication
3. **Certificate Validation**: Ensure SSL certificates are valid (self-signed certs may cause WebSocket failures)
4. **Timeout Settings**: WebSocket connections are long-lived - set appropriate timeouts (24+ hours)

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
# WebSocket upgrade mapping (add at top of nginx.conf, outside server block)
map $http_upgrade $connection_upgrade {
    default upgrade;
    '' close;
}

server {
    listen 443 ssl http2;
    server_name code.yourdomain.com;

    # SSL certificates (managed by Certbot)
    ssl_certificate /etc/letsencrypt/live/code.yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/code.yourdomain.com/privkey.pem;

    location / {
        proxy_pass http://localhost:8443;
        proxy_http_version 1.1;

        # WebSocket support (REQUIRED for code-server)
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;

        # Standard headers
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # WebSocket timeouts (24 hours)
        proxy_read_timeout 86400s;
        proxy_send_timeout 86400s;

        # Disable buffering for real-time updates
        proxy_buffering off;
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
