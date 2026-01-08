# DevOrbit Dashboard

**DevOrbit Dashboard** is an advanced local development environment manager that monitors, controls, and optimizes your development workflow. It integrates with Gemini AI to analyze project configurations and provide intelligent recommendations, making it easier to manage complex microservice architectures and local setups.

## 🚀 Features

- **Project Management**: Monitor and control local applications (Start, Stop, Restart).
- **Intelligent Analysis**: Uses Gemini AI to scan project structures and suggest run configurations.
- **Port Management**: Automatic detection of port conflicts with resolution options (kill process or pick new port).
- **System Monitoring**: Real-time CPU and Memory usage tracking for managed services.
- **Integrated Terminal**: Full-featured web-based terminal emulator for interacting with your services.
- **IDE Integration**: Seamlessly open projects in VS Code, Cursor, WebStorm, and other IDEs.
- **Docker Support**: Manage Docker containers and compose services directly from the dashboard.

## 🛠️ Tech Stack

- **Frontend**: React 19, Vite, Tailwind CSS, Lucide Icons, Recharts
- **Backend**: Node.js, Express, WebSocket (ws), node-pty
- **Database**: PostgreSQL (via Drizzle ORM)
- **Caching**: Redis
- **AI**: Google Gemini API

## 📋 Prerequisites

- **Node.js** (v18+ recommended)
- **Docker** & Docker Compose
- **Google Gemini API Key** (for AI features)

## 🏁 Getting Started

### 1. Clone & Install

```bash
git clone <repository-url>
cd devorbit-dashboard
npm install
```

### 2. Environment Setup

Create an `.env.local` file in the root directory:

```bash
GEMINI_API_KEY=your_api_key_here
# Optional: data persistence paths
# SCAN_DIRECTORIES=/Users/username/projects
```

### 3. Run Locally (Full Stack)

To run the entire stack including databases (Postgres, Redis) and the application:

```bash
npm run dev:full
```

This command starts the Docker infrastructure and the development servers for frontend and backend.

### Alternative: Manual Start

If you already have the databases running:

```bash
npm run dev
```

## 🏗️ Architecture

The project follows a monorepo-like structure with a unified backend and frontend:

- **`App.tsx`**: Main frontend entry point and state management.
- **`server/`**: Express backend handling API requests, websocket terminals, and OS interactions.
- **`services/`**: Core logic for AI analysis, port management, and file system scanning.
- **`docker/`**: Infrastructure configuration.

## 🐳 Docker Deployment

You can run the dashboard entirely within Docker:

```bash
docker compose up --build
```

Access the dashboard at `http://localhost:3000`.

---

## 💻 Web IDE: code-server Integration

DevOrbit Dashboard includes an integrated web-based IDE powered by **code-server** (VS Code in the browser) alongside the lightweight **Monaco Editor**. This gives you the flexibility to choose between a fast embedded editor or a full-featured IDE experience.

### Why Two Editors?

| Feature | Monaco Editor | code-server (VS Code) |
|---------|---------------|------------------------|
| **Load Time** | Instant | 2-3 seconds |
| **Memory Usage** | ~50MB | ~200-500MB |
| **Extensions** | ❌ No | ✅ Full VS Code marketplace |
| **Integrated Terminal** | ❌ No | ✅ Yes |
| **Git Integration** | ❌ Limited | ✅ Full GitLens, etc. |
| **Debugging** | ❌ No | ✅ Full debugging support |
| **Settings Sync** | ❌ No | ✅ Yes (with VS Code account) |
| **Best For** | Quick edits, config files | Full development, debugging |

**Recommendation:** Use Monaco for quick edits and code-server when you need the full IDE experience.

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

2. **Start code-server**

   ```bash
   docker compose up code-server -d
   ```

3. **Access from Dashboard**

   - Open DevOrbit Dashboard
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

#### Network Security

By default, code-server is **only accessible on localhost** (port 8443). This is secure for local development.

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
   server {
       listen 80;
       server_name code.yourdomain.com;

       location / {
           proxy_pass http://localhost:8443;
           proxy_set_header Host $host;
           proxy_set_header Upgrade $http_upgrade;
           proxy_set_header Connection upgrade;
           proxy_set_header Accept-Encoding gzip;
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
      cpus: '4.0'      # Increase for large projects
      memory: 4G
```

### 🔄 Migration Guide: Volume Mount Changes

**⚠️ BREAKING CHANGE:** If you previously used this project with hardcoded paths, volume mounts have been standardized.

**Before (version ≤ v1.x):**
```yaml
volumes:
  - /Users/example/Projects:/path/in/container
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
  - "8444:8080"  # Changed from 8443
```
```bash
# .env
VITE_CODE_SERVER_URL=http://localhost:8444
```

---
