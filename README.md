# Orkumo

> **Vision:** Orkumo ist die komplette Arbeitsumgebung für agentische Entwicklung (ADE): Issues planen, Agents steuern, Code editieren, Terminal, über alle Geräte hinweg, verbunden über den Kontext Issue ↔ Agent ↔ Worktree ↔ PR ↔ Code. Details: [docs/VISION.md](docs/VISION.md).

**Orkumo** is a workspace for agentic development: agents, code, board, workflows and terminal around your local projects.

## 🚀 Features

- **Overview**: agent situation (needs input, cache expiring, compaction needed), usage card, system health with top processes.
- **Usage** (`/usage`): tokens per day, model and provider (Claude Code, Codex accounts via `DEVORBIT_CODEX_HOMES`, MiniMax) and plan limits from local logs.
- **Integrated Terminal**: Full-featured web-based terminal emulator for interacting with your services.
- **IDE Integration**: Seamlessly open projects in VS Code, Cursor, WebStorm, and other IDEs.
- **Claude Code Agents**: Browser version of `claude agents` - dispatch, peek, reply, attach (in tabs or tiled), pin, rename, stop and delete background Claude Code sessions.

## 🛠️ Tech Stack

- **Frontend**: React 19, Vite, Tailwind CSS, Lucide Icons, Recharts
- **Backend**: Node.js, Express, WebSocket (ws), node-pty
- **Database**: PostgreSQL (via Drizzle ORM)
- **Caching**: Redis

## 📋 Prerequisites

- **Node.js** (v18+ recommended)
- **Docker** & Docker Compose

## 🏁 Getting Started

### 1. Clone & Install

```bash
git clone <repository-url>
cd Orkumo
bun install
```

### 2. Environment Setup

Create an `.env.local` file in the root directory:

```bash
# DEVORBIT_CODEX_HOMES=Codex A=~/.codex,Codex B=~/.codex-b
# Optional: data persistence paths
# SCAN_DIRECTORIES=/Users/username/projects
```

### 3. Run Locally (Full Stack)

To run the entire stack including databases (Postgres, Redis) and the application:

```bash
bun run dev:full
```

This command starts the Docker infrastructure and the development servers for frontend and backend.

### Alternative: Manual Start

If you already have the databases running:

```bash
bun run dev
```

## 🏗️ Architecture

The project follows a monorepo-like structure with a unified backend and frontend:

- **`App.tsx`**: Main frontend entry point and state management.
- **`server/`**: Express backend handling API requests, websocket terminals, and OS interactions.
- **`services/`**: Core logic for AI analysis, port management, and file system scanning.
- **`docker/`**: Infrastructure configuration.
- **Optional modules**: the server loads extra features from a directory if present, see [docs/MODULES.md](docs/MODULES.md).

## 🤖 Claude Code Agents View

Orkumo ships a browser counterpart of Claude Code's [agent view](https://code.claude.com/docs/en/agent-view) (`claude agents`). Open it from the sidebar (**Agents**, shortcut `a`) or at `/agents`.

It talks to the Claude Code CLI installed on the machine running the Orkumo server (`claude --bg`, `claude agents --json`, `claude logs|stop|respawn|rm`, `claude daemon …`) and reads the session state the CLI keeps under `~/.claude/jobs`. Requirements: Claude Code ≥ 2.1.2xx on the host, signed in once (`claude`). The view is not available in the Docker deployment (the CLI runs on the host, the API container has no access to it).

What you get:

- **Session list** grouped by state (Pinned · Ready for review · Needs input · Working · Completed) or by directory (`Ctrl+S`), with state glyphs, activity summary, age and PR/MR labels. Completed sessions fold into `… N more`.
- **Dispatch input** with the TUI syntax: `<agent> prompt`, `@agent`, `@repo`, `/resume`, `/model`, `/effort`, skills as `/name`, `! shell command` (background job), `#123` / PR URL to select a session, and filters `a:<agent>`, `s:<state>`, `#<n>`, URL. Prompts shorter than 4 characters are rejected as `Too short`.
- **Peek panel** (`Space`): recent output (`claude logs`, transcript fallback for exited sessions), blocking question, numbered choices, `Tab` for the suggested reply, `!` for a shell command. Replies are delivered through a hidden `claude attach` so permission prompts and questions can be answered without opening the session.
- **Attach in tabs** (`Enter` / `→` / `Alt+1…9`): each attached session is a real terminal running `claude attach <id>`. Tabs can be **tiled** as columns, rows or a grid. `Ctrl+Z` (or the detach button) leaves the session running.
- **Manage**: pin (`Ctrl+T`, `Alt+P` in browsers), rename (`Ctrl+R`), reorder (`Shift+↑/↓`), delete with confirmation (`Ctrl+X` or row menu), delete a whole group, respawn, force-delete hints from `claude rm` (`--discard-unpushed`, `--force-remove-worktree`).
- **Dispatch defaults** (gear icon): the flags `claude agents` accepts - `--model`, `--effort`, `--permission-mode`, `--agent`, `--dangerously-skip-permissions`, `--allow-dangerously-skip-permissions`, `--restricted`, `--settings`, `--add-dir`, `--plugin-dir`, `--mcp-config`, `--strict-mcp-config`, `--fallback-model` - plus the `--cwd` scope, notifications and the supervisor controls (`claude daemon status|stop`, `claude respawn --all`).
- **Notifications** when a session needs input, finishes or fails (in-app toasts, optional browser notifications), and the tab title shows `N awaiting input · claude agents`.
- Press `?` inside the view for the full shortcut list.

Security: sessions can only be dispatched into (and `--add-dir` only point at) the project directories configured in the admin panel; the server resolves symlinks before checking. Flags that widen a session's reach (`--dangerously-skip-permissions`, `--allow-dangerously-skip-permissions`, `--settings`, `--mcp-config`, `--plugin-dir`) are refused with `403` unless the server runs with `DEVORBIT_AGENTS_ALLOW_UNSAFE_FLAGS=true`.

API: `GET /api/agents`, `GET /api/agents/stream` (SSE), `POST /api/agents/dispatch`, `GET /api/agents/:id/logs`, `POST /api/agents/:id/reply|stop|respawn`, `DELETE /api/agents/:id`, `PUT /api/agents/:id/name|pin`, `PUT /api/agents/order`, `GET /api/agents/daemon`, `POST /api/agents/daemon/stop`, `GET /api/agents/subagents|repos|commands|past`, `GET|PUT /api/settings/agent-view`.

## 📱 Remote-Zugang für mobile Clients

Der Server kann Clients außerhalb des Macs bedienen, etwa die iOS-App für iPhone und iPad. Die App gehört zu DevHub Pro (privates Repo `hpmartini/DevHub-pro`, `apps/ios`) und wird dort gegen einen DevHub-Checkout gebaut. Sie ist ein reiner Client: Server, PTY und `claude` laufen weiter auf dem Mac, die Verbindung läuft über das Tailscale-Tailnet.

**1. Remote-Zugang auf dem Mac einschalten** (Default: aus, alles bleibt localhost-only)

```bash
DEVORBIT_REMOTE=true bun run server          # oder DEVORBIT_REMOTE=true in .env.local
tailscale serve --bg --https=8443 http://127.0.0.1:3099   # HTTPS nur im Tailnet (3099 = Standard-SERVER_PORT)
```

- Mit `DEVORBIT_REMOTE=true` braucht jede Anfrage, die nicht direkt von localhost kommt (auch über `tailscale serve`), den Pairing-Token. Er liegt in `<data>/remote-token` (Modus 600) und wird beim ersten Start erzeugt. Der Server lauscht dann nur auf `127.0.0.1`; von außen kommt man ausschließlich über `tailscale serve` heran.
- HTTPS ist Pflicht: WKWebView blockt `http`-Fetch und -WebSocket aus der App (`capacitor://`) als Mixed Content. Bind an die Tailnet-IP mit http reicht daher nicht.
- Geteilter Rechner (VPS): `DEVORBIT_TRUST_LOOPBACK=false` setzen, dann brauchen auch Anfragen direkt von localhost den Pairing-Token (HTTP und `/api/pty`). code-server läuft dann ohne TCP-Port auf dem Unix-Socket `<data>/code-server.sock` (Modus 600) und ist nur über `/api/code-server/proxy` erreichbar. Standard ist `true`, damit die Electron-App auf dem eigenen Rechner ohne Token läuft.
- Läuft `tailscale serve` auf einem anderen Port als 443 oder unter anderem Namen: `DEVORBIT_REMOTE_URL=https://<mac>.<tailnet>.ts.net:8443` setzen, sonst nimmt die Pairing-Anzeige `https://<MagicDNS-Name>`.

**2. Koppeln:** Admin Panel → „iOS-App“ zeigt Adresse, Token, den Link `devorbit://pair?…` und denselben Link als QR-Code.

**Desktop-App als Client eines anderen Rechners:** Mit `ORKUMO_REMOTE='devorbit://pair?…'` (Umgebung oder `.env.local`, der Link aus Schritt 2) startet die Electron-App keinen eigenen Server und arbeitet gegen den gekoppelten: `ORKUMO_REMOTE='devorbit://pair?…' open -a Orkumo`. Der Server lässt den `file://`-Renderer einer fremden App nur mit gültigem Token zu. Nicht über diesen Weg: Modul-Oberflächen (ihr Skript-Import kann keinen Token tragen) und Aktionen, die auf dem Server-Rechner Programme öffnen. Nachweis: `scripts/review/pro8-app.sh`.

**Gebündelte Clients:** Eine App, die den Web-Build mitbringt, ersetzt `index.tsx` durch einen eigenen Einstieg und nutzt `App.tsx`, `utils/apiConfig.ts` (`isNativeApp`, `pairing`) und `utils/remoteClient.ts` (Pairing, Token an fetch, SSE und WebSocket). Erkannt wird sie an einem Nicht-Web-Origin (z. B. `capacitor://`); dann gelten HashRouter und die gespeicherte Server-Adresse.

## 🐳 Docker Deployment

You can run the dashboard entirely within Docker:

```bash
docker compose up --build
```

Access the dashboard at `http://localhost:3000`.

### Docker from a release (no checkout, no build)

Every [release](https://github.com/hpmartini/Orkumo/releases) ships the desktop installers (`.dmg`, `.AppImage`, `.deb`, `.rpm`, see [DESKTOP.md](DESKTOP.md)) and multi-arch images (`ghcr.io/hpmartini/devhub-api`, `devhub-frontend`, amd64 + arm64).

```bash
mkdir orkumo && cd orkumo
gh release download <tag> --repo hpmartini/Orkumo -p docker-compose.release.yml -p init-db.sql  # <tag> from the releases page, e.g. v1.0.0
docker compose -f docker-compose.release.yml up -d   # http://localhost:3000
```

Optional `.env` next to the compose file: `POSTGRES_PASSWORD`, `GEMINI_API_KEY`, `DEVORBIT_PORT` (default 3000), `DEVORBIT_PROJECTS_DIR` (default `~/Projects`), `PTY_HOST_HTTP_TOKEN`.
Terminals need the PTY-Host on the host: `git clone` this repo, `bun run pty-host:install && bun run pty-host` (ports 3096/3097). It binds to `127.0.0.1`, which Docker Desktop reaches; on Linux set `PTY_HOST_BIND` to the `docker0` IP (usually `172.17.0.1`), not `0.0.0.0`.

---

## 💻 Web IDE: code-server Integration

Orkumo embeds **code-server** (VS Code in the browser) as its only integrated editor: extensions, integrated terminal, git and debugging, opened directly on the project folder.

### 🚀 Quick Setup

1. **Set a Strong Password**

   Copy `.env.example` to `.env` and set a secure password:

   ```bash
   cp .env.example .env
   ```

   Edit `.env` and set:

   ```bash
   # Generate a strong password (example using openssl)
   CODE_SERVER_PASSWORD=$(openssl rand -base64 24)

   # Or use a password manager to generate one
   # Requirements: 12+ chars, mixed case, numbers, special chars
   CODE_SERVER_PASSWORD=your_secure_password_here
   ```

2. **Validate Password (Recommended)**

   Run the validation script to ensure your password meets security requirements:

   ```bash
   ./scripts/validate-code-server-password.sh
   ```

   This checks for:
   - Minimum length (12+ characters)
   - Uppercase, lowercase, numbers, special characters
   - Common weak patterns

3. **Start code-server**

   ```bash
   docker compose up code-server -d
   ```

4. **Access from Dashboard**
   - Open Orkumo
   - Navigate to any project's detail view
   - Click the editor switcher in the top-right
   - Select "VS Code"
   - Enter your password when prompted

### 🔒 Security Best Practices

> **⚠️ CRITICAL:** code-server provides full access to your Projects directory with sudo privileges. A compromised password means attackers can read, modify, or delete ALL your code and execute arbitrary commands.

#### Password Security

- **✅ DO:**
  - Use a password manager to generate and store passwords
  - Use 16+ characters with mixed case, numbers, and symbols
  - Use different passwords for each service
  - Rotate passwords periodically (every 90 days)

- **❌ DON'T:**
  - Use weak passwords (e.g., "password123", "devOrbit123")
  - Reuse passwords from other services
  - Share passwords in plaintext (Slack, email, etc.)
  - Commit `.env` files to version control

#### Network Architecture

Orkumo uses an nginx reverse proxy to route traffic to services:

```
Browser → http://localhost:3000/code-server/ → Nginx (frontend container) → code-server:8080
```

**Key Points:**

- code-server is accessed through nginx proxy at `/code-server/` path
- Port 8443 is bound to `127.0.0.1` (localhost only) for security
- All communication goes through the internal Docker network `devorbit-network`
- Port 8443 on localhost is for optional direct access (debugging only)

#### Network Security

By default, code-server is **only accessible through the nginx proxy** on localhost. This is secure for local development.

**For Remote Access:**

- ✅ **Use SSH tunnel** (most secure):

  ```bash
  ssh -L 8443:localhost:8443 user@your-server
  ```

  Then access via `http://localhost:8443` on your local machine

- ✅ **Use VPN** (e.g., Tailscale, WireGuard)
- ✅ **Use HTTPS reverse proxy** (see HTTPS Setup below)
- ❌ **NEVER expose port 8443 directly to the internet**

#### Docker Security Considerations

- code-server runs with **sudo privileges** inside the container
- Mounted volumes (`/home/coder/Projects`) are **read-write**
- Resource limits are configured (2 CPU, 2GB RAM) to prevent DoS

**Optional: Disable Sudo (Recommended)**

If you don't need sudo access inside code-server terminals:

```bash
# In .env file, leave this EMPTY to disable sudo:
CODE_SERVER_SUDO_PASSWORD=
```

### 🔐 HTTPS Setup (Production)

Running code-server over HTTP means passwords and code are transmitted in plaintext. For production or remote access, use HTTPS.

> **⚠️ IMPORTANT:** When deploying with HTTPS, your reverse proxy MUST properly handle WebSocket upgrades. code-server requires WebSocket support for terminal functionality, file watching, and real-time features. Failure to configure WebSocket support will result in broken terminal and file synchronization.

**Key Requirements for HTTPS Deployment:**

1. **WebSocket Protocol**: Use `wss://` (WebSocket Secure) instead of `ws://`
2. **Valid SSL Certificates**: Self-signed certificates may cause WebSocket connection failures
3. **Proper Proxy Headers**: Must forward `Upgrade` and `Connection` headers
4. **HTTP/1.1 Required**: WebSocket requires HTTP/1.1 (not HTTP/2 for WebSocket connections)
5. **Long Timeouts**: WebSocket connections are persistent (24+ hours recommended)
6. **No Buffering**: Disable proxy buffering for real-time communication

#### Option 1: Caddy (Recommended - Automatic HTTPS)

1. **Install Caddy:**

   ```bash
   # macOS
   brew install caddy

   # Ubuntu/Debian
   sudo apt install caddy
   ```

2. **Create Caddyfile:**

   ```
   code.yourdomain.com {
       reverse_proxy localhost:8443
   }
   ```

3. **Start Caddy:**

   ```bash
   caddy run
   ```

   Caddy automatically obtains Let's Encrypt SSL certificates.

4. **Update `.env`:**
   ```bash
   VITE_CODE_SERVER_URL=https://code.yourdomain.com
   ```

#### Option 2: Nginx with Certbot

1. **Install Nginx and Certbot:**

   ```bash
   sudo apt install nginx certbot python3-certbot-nginx
   ```

2. **Create Nginx config** (`/etc/nginx/sites-available/code-server`):

   ```nginx
   # WebSocket upgrade mapping (add at top of nginx.conf, outside server block)
   map $http_upgrade $connection_upgrade {
       default upgrade;
       '' close;
   }

   server {
       listen 80;
       server_name code.yourdomain.com;

       location / {
           proxy_pass http://localhost:8443;
           proxy_http_version 1.1;

           # WebSocket support (REQUIRED)
           proxy_set_header Upgrade $http_upgrade;
           proxy_set_header Connection $connection_upgrade;

           # Standard headers
           proxy_set_header Host $host;
           proxy_set_header X-Real-IP $remote_addr;
           proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
           proxy_set_header X-Forwarded-Proto $scheme;

           # WebSocket timeouts
           proxy_read_timeout 86400s;
           proxy_send_timeout 86400s;

           # Disable buffering
           proxy_buffering off;
       }
   }
   ```

3. **Enable site and get SSL:**

   ```bash
   sudo ln -s /etc/nginx/sites-available/code-server /etc/nginx/sites-enabled/
   sudo certbot --nginx -d code.yourdomain.com
   sudo systemctl reload nginx
   ```

4. **Update `.env`:**
   ```bash
   VITE_CODE_SERVER_URL=https://code.yourdomain.com
   ```

#### Option 3: SSH Tunnel (No Setup Required)

Most secure for personal remote access:

```bash
# On your local machine:
ssh -L 8443:localhost:8443 user@your-server

# Access via http://localhost:8443 (encrypted through SSH)
```

#### Option 4: Cloudflare Tunnel (Zero Trust)

```bash
# Install cloudflared
brew install cloudflare/cloudflare/cloudflared

# Login and create tunnel
cloudflared tunnel login
cloudflared tunnel create devorbit-code
cloudflared tunnel route dns devorbit-code code.yourdomain.com

# Configure tunnel (config.yml)
tunnel: <tunnel-id>
credentials-file: /path/to/credentials.json

ingress:
  - hostname: code.yourdomain.com
    service: http://localhost:8443
  - service: http_status:404

# Run tunnel
cloudflared tunnel run devorbit-code
```

### 📦 Resource Limits

code-server is configured with resource limits to prevent excessive consumption:

- **CPU:** 2 cores max, 0.5 reserved
- **Memory:** 2GB max, 512MB reserved

Adjust in `docker-compose.yml` if needed:

```yaml
deploy:
  resources:
    limits:
      cpus: '4.0' # Increase for large projects
      memory: 4G
```

### 🔄 Migration Guide: Volume Mount Changes

**⚠️ BREAKING CHANGE:** If you previously used this project with hardcoded paths, volume mounts have been standardized.

**Before (version ≤ v1.x):**

```yaml
volumes:
  - /Users/hape/Projects:/path/in/container
```

**After (version v2.0+):**

```yaml
volumes:
  - ${HOME}/Projects:/home/coder/Projects
  - ${HOME}/PROJECTS:/home/coder/PROJECTS
```

**Impact:**

- Both `api` and `code-server` services now use consistent mount paths
- Environment variable `${HOME}` makes it work across different users
- If you have custom mount paths, update them in `docker-compose.yml`

**Action Required:**

1. Review your `docker-compose.yml` volume mounts
2. If you have customizations, update paths to use `${HOME}` or absolute paths
3. Restart services: `docker compose down && docker compose up -d`

### 🐛 Troubleshooting

#### code-server won't start

**Error:** `CODE_SERVER_PASSWORD must be set`

**Fix:** Set `CODE_SERVER_PASSWORD` in `.env` file:

```bash
CODE_SERVER_PASSWORD=your_secure_password_here
```

#### Timeout errors in dashboard

**Symptoms:** "Failed to load VS Code (timeout)" after 15 seconds

**Causes & Fixes:**

- code-server container not running
  ```bash
  docker compose ps code-server
  docker compose up code-server -d
  ```
- Firewall blocking port 8443

  ```bash
  # macOS
  sudo /usr/libexec/ApplicationFirewall/socketfilterfw --add code-server

  # Linux
  sudo ufw allow 8443
  ```

- Container still starting (wait 30-40 seconds)
  ```bash
  docker compose logs -f code-server
  ```

#### Wrong files visible in code-server

**Symptoms:** Can't see project files, or wrong directory opens

**Fix:** Verify path mapping in browser console (F12):

```
[WebIDEPanel] Mapped path: /Users/you/Projects/myapp -> /home/coder/Projects/myapp
```

If path doesn't match, your project directory name doesn't match the expected pattern. Update volume mounts in `docker-compose.yml`:

```yaml
- /your/custom/path:/home/coder/Projects
```

#### Permission errors

**Symptoms:** "Permission denied" when editing files

**Fix:** Ensure host directories have correct permissions:

```bash
chmod -R u+rw ~/Projects
```

#### Port already in use

**Error:** `Bind for 0.0.0.0:8443 failed: port is already allocated`

**Fix:** Change port in `docker-compose.yml` and `.env`:

```yaml
# docker-compose.yml
ports:
  - '8444:8080' # Changed from 8443
```

```bash
# .env
VITE_CODE_SERVER_URL=http://localhost:8444
```

### 🌐 CORS and Cross-Origin Configuration

code-server runs on a **different origin** than the Orkumo (different ports), which can cause CORS-related issues in certain scenarios.

#### Default Configuration

By default, code-server loads in an iframe at `http://localhost:8443` while the dashboard runs at `http://localhost:3000`. This works because:

1. **Iframe sandbox**: Restricts cross-origin access for security
2. **CORS not required**: The iframe loads code-server directly, not via XHR/fetch

#### When CORS Issues Occur

You may encounter CORS errors if:

1. **Different domains**: Running dashboard and code-server on different domains

   ```
   Dashboard: https://app.example.com
   code-server: https://code.example.com
   ```

2. **Custom reverse proxy**: Using a reverse proxy that doesn't forward CORS headers properly

3. **Browser security policies**: Some browsers enforce stricter CORS policies

#### Solutions

**Option 1: Same Domain with Path-based Routing (Recommended)**

Configure your reverse proxy to serve both on the same domain:

```nginx
# Nginx example
server {
    listen 443 ssl;
    server_name app.example.com;

    # Dashboard
    location / {
        proxy_pass http://localhost:3000;
    }

    # code-server
    location /code/ {
        proxy_pass http://localhost:8443/;
        proxy_set_header Host $host;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection upgrade;
    }
}
```

Then update `.env`:

```bash
VITE_CODE_SERVER_URL=https://app.example.com/code
```

**Option 2: Configure CORS Headers**

If you must use different domains, configure code-server's reverse proxy to allow cross-origin requests:

```nginx
# Nginx example
location / {
    proxy_pass http://localhost:8443;

    # CORS headers
    add_header Access-Control-Allow-Origin "https://app.example.com" always;
    add_header Access-Control-Allow-Methods "GET, POST, OPTIONS" always;
    add_header Access-Control-Allow-Headers "Authorization, Content-Type" always;
    add_header Access-Control-Allow-Credentials "true" always;
}
```

**Option 3: Use localhost for Both**

For local development, keep both services on localhost with different ports. This avoids CORS issues entirely:

```bash
Dashboard: http://localhost:3000
code-server: http://localhost:8443
```

#### Debugging CORS Issues

1. **Check browser console** (F12 → Console tab) for CORS errors:

   ```
   Access to iframe at 'http://localhost:8443' from origin 'http://localhost:3000'
   has been blocked by CORS policy
   ```

2. **Verify iframe sandbox attribute**:
   - The iframe should NOT have `allow-same-origin` if running on different origins
   - Check `components/CodingView/WebIDEPanel.tsx` line 473

3. **Test code-server directly**:
   - Open `http://localhost:8443` in a separate tab
   - If it works there but not in the iframe, it's likely a sandbox/CORS issue

4. **Check reverse proxy logs**:

   ```bash
   # Nginx
   sudo tail -f /var/log/nginx/error.log

   # Caddy
   caddy logs
   ```

#### Security Note

Configuring CORS headers reduces security isolation. Only allow specific origins, never use `Access-Control-Allow-Origin: *` with `Access-Control-Allow-Credentials: true`.

---
