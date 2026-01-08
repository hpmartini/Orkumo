<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/drive/17ngup61QHOOA9SB63VIkju3ZxNvp4KPO

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `npm run dev`

## Features

### Web IDE Integration (Monaco Editor + code-server)

DevOrbit Dashboard includes two integrated code editors accessible directly from project detail views:

#### 1. Monaco Editor (Lightweight, Built-in)
- Fast, embedded code editor (same engine as VS Code)
- File tree browser with syntax highlighting
- Multiple file tabs with save functionality
- No additional setup required
- Ideal for quick edits and code review

#### 2. code-server (Full VS Code Experience)
- Complete VS Code running in your browser
- Full extension marketplace support
- Integrated terminal, debugger, and git
- All VS Code features available
- Requires Docker setup (see below)

You can switch between editors using the toggle in the Web IDE panel.

---

### Setting Up code-server (VS Code in Browser)

#### Quick Start

1. **Create your `.env` file** (if you haven't already):
   ```bash
   cp .env.example .env
   ```

2. **Set a secure password** in `.env`:
   ```bash
   # Generate a strong password (example using openssl)
   openssl rand -base64 24

   # Add to .env file:
   CODE_SERVER_PASSWORD=your_generated_password_here
   ```

3. **Start code-server**:
   ```bash
   docker compose up code-server -d
   ```

4. **Access code-server**:
   - Open any project in DevOrbit Dashboard
   - Go to the "Coding View" tab
   - Click "VS Code" in the Web IDE panel
   - Enter your password when prompted

#### 🔒 Security Best Practices

**CRITICAL: Password Security**

The `CODE_SERVER_PASSWORD` protects access to your entire codebase. Anyone with this password can:
- Read and modify all your project files
- Execute arbitrary commands with sudo privileges
- Access environment variables and secrets
- Install software and VS Code extensions

**Strong Password Requirements:**
- ✅ Minimum 12 characters
- ✅ Mix of uppercase, lowercase, numbers, and special characters
- ✅ Unique (never reuse from other services)
- ✅ Generated using a password manager or tool
- ✅ Never committed to version control

**Example of generating a secure password:**
```bash
# Using openssl
openssl rand -base64 24

# Using pwgen (if installed)
pwgen -s 20 1

# Using macOS/Linux
LC_ALL=C tr -dc 'A-Za-z0-9!@#$%^&*' < /dev/urandom | head -c 20
```

**Network Security:**
- By default, code-server runs on `localhost:8443` (not accessible from network)
- **NEVER** expose port 8443 directly to the internet
- For remote access, use one of these secure methods:
  - SSH tunnel (recommended for personal use)
  - VPN (recommended for team access)
  - Reverse proxy with HTTPS (see HTTPS Setup below)

**Docker Security:**
- code-server runs with sudo privileges inside the container
- Project directories are mounted with read/write access
- Review mounted volumes in `docker-compose.yml` before running
- Consider using read-only mounts for sensitive directories

**Access Control:**
- Only share the password with trusted team members
- Use different passwords for different environments (dev/staging/prod)
- Rotate passwords periodically (every 90 days recommended)
- Revoke access by changing the password and restarting the container

---

### HTTPS Setup for code-server

For production or remote access, you should run code-server behind a reverse proxy with SSL/TLS.

#### Option 1: Caddy (Recommended - Automatic HTTPS)

1. **Install Caddy**: https://caddyserver.com/docs/install

2. **Create a Caddyfile**:
   ```caddy
   code.yourdomain.com {
       reverse_proxy localhost:8443
   }
   ```

3. **Run Caddy**:
   ```bash
   caddy run --config Caddyfile
   ```

Caddy automatically obtains and renews SSL certificates from Let's Encrypt.

#### Option 2: Nginx with Let's Encrypt

1. **Install Nginx and Certbot**:
   ```bash
   # Ubuntu/Debian
   sudo apt install nginx certbot python3-certbot-nginx

   # macOS
   brew install nginx certbot
   ```

2. **Create Nginx configuration** (`/etc/nginx/sites-available/code-server`):
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

3. **Enable site and get SSL certificate**:
   ```bash
   sudo ln -s /etc/nginx/sites-available/code-server /etc/nginx/sites-enabled/
   sudo certbot --nginx -d code.yourdomain.com
   sudo systemctl reload nginx
   ```

4. **Update your `.env` file**:
   ```bash
   VITE_CODE_SERVER_URL=https://code.yourdomain.com
   ```

#### Option 3: SSH Tunnel (For Personal Remote Access)

Most secure option for accessing code-server remotely without exposing it to the internet:

```bash
# From your remote machine
ssh -L 8443:localhost:8443 user@your-devhub-server

# Now access http://localhost:8443 on your remote machine
```

#### Option 4: Cloudflare Tunnel (Zero Trust Access)

1. **Install cloudflared**: https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/install-and-setup/

2. **Create a tunnel**:
   ```bash
   cloudflared tunnel create devorbit-code
   cloudflared tunnel route dns devorbit-code code.yourdomain.com
   ```

3. **Configure the tunnel** (`~/.cloudflared/config.yml`):
   ```yaml
   tunnel: <tunnel-id>
   credentials-file: /path/to/credentials.json

   ingress:
     - hostname: code.yourdomain.com
       service: http://localhost:8443
     - service: http_status:404
   ```

4. **Run the tunnel**:
   ```bash
   cloudflared tunnel run devorbit-code
   ```

---

### Troubleshooting code-server

**code-server won't start:**
```bash
# Check if CODE_SERVER_PASSWORD is set
docker compose config | grep CODE_SERVER_PASSWORD

# View logs
docker compose logs code-server

# Restart the container
docker compose restart code-server
```

**"Failed to load VS Code (timeout)" error:**
- Check if code-server container is running: `docker compose ps`
- Verify the container is healthy: `docker compose logs code-server`
- Ensure port 8443 is not blocked by firewall
- Try accessing directly: http://localhost:8443

**Password not accepted:**
- Verify the password in your `.env` file (no quotes needed)
- Restart code-server: `docker compose restart code-server`
- Check for special characters that might need escaping

**Files not showing in code-server:**
- Verify volume mounts in `docker-compose.yml`
- Check that project paths match the mounted volumes
- Restart code-server after changing volume configuration

**Permission denied errors:**
- Ensure your user has read/write access to project directories
- Check Docker volume permissions
- On Linux, verify your user is in the `docker` group

**Port 8443 already in use:**
- Check what's using the port: `lsof -i :8443` (macOS/Linux)
- Change the port in `docker-compose.yml`:
  ```yaml
  ports:
    - "9443:8080"  # Changed from 8443
  ```
- Update `VITE_CODE_SERVER_URL` in `.env` to match

---

### IDE Integration

DevOrbit Dashboard supports opening projects directly in your favorite IDE from the application detail view. The feature automatically detects installed IDEs and provides a convenient button to launch them.

#### Supported IDEs

- **Visual Studio Code** - Cross-platform code editor
- **Cursor** - AI-powered code editor
- **WebStorm** - JavaScript and TypeScript IDE
- **IntelliJ IDEA** - Java IDE
- **PhpStorm** - PHP IDE
- **PyCharm** - Python IDE
- **Sublime Text** - Text editor

#### Platform Support

- **macOS**: Detects applications in `/Applications/`
- **Linux**: Supports standard installations, Snap packages, and Flatpak apps
- **Windows**: Detects IDEs in `Program Files` and user-specific directories

#### Custom IDE Paths

If your IDE is installed in a non-standard location, you can set custom paths using environment variables:

```bash
# .env.local
VSCODE_PATH=/custom/path/to/vscode
CURSOR_PATH=/custom/path/to/cursor
WEBSTORM_PATH=/custom/path/to/webstorm
INTELLIJ_PATH=/custom/path/to/intellij
PHPSTORM_PATH=/custom/path/to/phpstorm
PYCHARM_PATH=/custom/path/to/pycharm
SUBLIME_PATH=/custom/path/to/sublime
```

**Note:** After changing environment variables, you must restart the backend server for the changes to take effect.

#### Preferred IDE

The dashboard remembers your preferred IDE for each project. When you open a project in an IDE, it becomes the default for that project. You can change the preferred IDE anytime from the dropdown menu.

#### Troubleshooting

**IDE not detected:**
- Verify the IDE is installed and accessible
- For custom installations, set the appropriate environment variable
- On Linux, ensure the IDE is in your PATH or installed via Snap/Flatpak

**Launch fails:**
- Check file permissions on the project directory
- Verify the IDE application is not corrupted
- On macOS, ensure the IDE is in the `/Applications/` folder or set a custom path
- On Linux, try reinstalling via your package manager

**Permission denied:**
- Ensure you have read access to the project directory
- On Linux/macOS, check directory permissions with `ls -la`
- Verify the IDE executable has execute permissions

**IDE opens but shows wrong directory:**
- This may happen if the project path contains symbolic links
- Try using the absolute path to the project

#### Technical Details

- IDE detection results are cached for 5 minutes to improve performance
  - Force cache refresh by adding `?refresh=true` to the IDE detection endpoint
  - Cache is automatically invalidated when an IDE launch fails
- The feature uses secure process spawning to prevent command injection
- Path validation prevents directory traversal attacks
- Rate limiting (10 launches per minute) prevents abuse
- Error responses include specific error codes for better debugging
- Error messages are sanitized to prevent exposure of sensitive paths
