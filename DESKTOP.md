# Orkumo - Desktop Application

Orkumo is now available as a native desktop application using Electron! This provides a seamless native experience with all the features of the web version.

## Features

✨ **Native Desktop Experience**

- Native window management and system integration
- System tray support (planned)
- Native file dialogs and notifications
- Platforms: macOS and Linux (native Windows is not supported; use WSL for the server)

🔋 **Full Feature Parity**

- All web features work identically in desktop mode
- Terminal emulation with xterm.js
- Real-time process monitoring
- AI-powered project analysis
- Docker support

🚀 **Performance**

- Local backend server (no network latency)
- Native module support (node-pty, pidusage)
- Optimized for desktop workflows

## Installation

### Download Pre-built Binaries

Download the latest release for your platform from the [Releases](https://github.com/hpmartini/Orkumo/releases) page (pre-releases `vX.Y.Z-rc.N` count):

- **macOS**: `Orkumo-<version>-arm64.dmg` (Apple Silicon) or `Orkumo-<version>.dmg` (Intel)
- **Linux**: Download `.AppImage`, `.deb`, or `.rpm` based on your distribution

**macOS, once:** the builds are not notarized, so Gatekeeper blocks the first start ("damaged" / "cannot be opened"). Install by hand once; every later version arrives by itself (see [Updates](#updates)):

1. Quit a running Orkumo.
2. Open the dmg and drag Orkumo into Applications (replace the old one). Or: `gh release download -R hpmartini/Orkumo <tag> -p 'Orkumo-*-arm64.dmg'`.
3. `xattr -cr /Applications/Orkumo.app`
4. Start Orkumo.

Install as a user who may write to `/Applications` (admin), and from the Applications folder, not from inside the dmg: otherwise the app can only point to the release page.

Prefer Docker? Each release also ships GHCR images and a compose file, see [README: Docker from a release](README.md#docker-from-a-release-no-checkout-no-build).

### Building from Source

1. **Clone the repository**

```bash
git clone https://github.com/hpmartini/Orkumo.git
cd Orkumo
```

2. **Install dependencies**

```bash
bun install
```

3. **Run in development mode**

```bash
bun run electron:dev
```

4. **Build for production**

```bash
# Build for current platform
bun run electron:build

# Build for specific platform
bun run electron:build:mac      # macOS
bun run electron:build:linux    # Linux

# Build for all platforms (requires platform-specific tools)
bun run electron:build:all
```

## Usage

### First Launch

1. **Start the application**
   - macOS: Double-click the app in Applications folder
   - Linux: Run the AppImage or installed application

2. **Configure directories**
   - Open Settings (Admin Panel)
   - Add directories to scan for projects
   - The app will automatically detect and analyze your development projects

3. **Start managing your projects!**
   - See agent status, token usage and system load on the overview
   - Open detected projects in Code mode
   - Access terminal sessions

### Keyboard Shortcuts

- **Refresh**: `Cmd/Ctrl + R`
- **Toggle DevTools**: `Cmd/Ctrl + Shift + I` (development mode)
- **Quit**: `Cmd/Ctrl + Q`
- **Minimize**: `Cmd/Ctrl + M`
- **Full Screen**: `Cmd/Ctrl + F`
- **Settings**: `Cmd + ,` (macOS app menu "Orkumo"; on Linux `Ctrl + ,` in File)

### Development Mode

When running in development mode (`bun run electron:dev`):

- Hot Module Replacement (HMR) is enabled for the frontend
- DevTools are automatically opened
- Backend server runs with live reloading
- Logs are printed to the terminal

### Quick window

`Alt+Shift+Space` (system-wide, while Orkumo runs) toggles a small prompt field above all windows. Enter brings Orkumo to the front and opens the chat composer with the text, Escape or a click elsewhere hides it. Set `ORKUMO_QUICK_SHORTCUT` (an [Electron accelerator](https://www.electronjs.org/docs/latest/api/accelerator), also in `.env.local`) for another shortcut, or to nothing to turn it off. A shortcut another app already holds is logged and not taken.

### Updates

Orkumo checks [GitHub Releases](https://github.com/hpmartini/Orkumo/releases) 5 s after start and every 6 h (`electron/updater.js`, #126), downloads a newer version in the background and shows a small banner, bottom right: "Orkumo X is ready", **Restart to update**. A plain quit installs it as well. There are no dialogs: a failed background check only shows in Settings → Updates and the log.

| Installation                                                                            | Behaviour                                                                                                                |
| --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Linux AppImage                                                                          | downloads, installs on restart (electron-updater)                                                                        |
| macOS, signed with a Developer ID                                                       | downloads, installs on restart (Squirrel.Mac)                                                                            |
| macOS ad-hoc (CI) or self-signed (local build), in a folder the user may write to       | downloads the zip, checks its sha512 against the release's `latest-mac.yml`, swaps the bundle (`electron/selfUpdate.js`) |
| macOS app in a read-only place (started from the dmg, App Translocation), `.deb`/`.rpm` | banner with a link to the release page                                                                                   |

**By hand:** app menu "Orkumo" → **Check for Updates…** (the banner shows the result), or Settings (`Cmd + ,`) → **Updates**: version and channel, last check, **Check now**, status (up to date / downloading x % / ready / error with reason), **Restart to update**, and the switch for automatic updates (`autoUpdate` in `settings.json`; off: no timed checks, no install on quit). In the browser the section only shows the version.

**Channels:** final installs get final releases; rc installs get newer `-rc.N` and final releases; local builds (`-dev.<sha>`, see below) get both, so a local build moves on to the next GitHub release. Only `vX.Y.Z` and `vX.Y.Z-rc.N` tags count: `v1.0.0-rc7` (old form) would outrank every `-rc.N` and is ignored.

**macOS swap:** the zip goes to `~/Library/Application Support/devorbit-dashboard/updates/`, must match size and sha512 of the release's `latest-mac.yml`, is unpacked with `ditto` into `updates/staging/`, checked (bundle id, version, `codesign --verify --deep`) and freed of quarantine. **Restart to update** starts a detached helper (`updates/swap.sh`, log `updates/swap.log`) that waits for Orkumo to exit, moves the update next to the app, renames `Orkumo.app` to `.Orkumo.app.update-backup` and the update into place, relaunches it with `open` and deletes the backup; a failed step renames the old app back and starts it. Renaming instead of copying keeps agents running: their PTY holders use the old binary. The signature does not matter (ad-hoc and self-signed swap alike), but every ad-hoc build has a new code identity, so macOS may ask again for permissions granted to Orkumo (Accessibility, Automation, keychain).

**Local builds** (`bun run electron:build*`, `scripts/release/build-local.mjs`) are stamped `<version>-dev.<sha>` via electron-builder's `extraMetadata`, below every rc of that version; `package.json` stays untouched. CI stamps `vX.Y.Z-rc.N` from the tag.

`ORKUMO_DISABLE_UPDATES=1` turns updates off. `ORKUMO_UPDATE_FEED=http://host:port` (loopback only) points them at a fake GitHub (`scripts/review/126/`, `test/selfUpdate.e2e.test.js`).

### Releases

Every merge to `main` becomes a pre-release, built by Woodpecker (`.woodpecker/release-*.yml`; GitHub Actions is off since #258):

1. `release-prepare` creates a draft `vX.Y.Z-rc.N` on the merge commit: X.Y.Z from `package.json`, N one above the highest rc of that version (`scripts/release/release-tag.sh`). A restarted pipeline reuses the draft of its commit. Once `vX.Y.Z` itself is released the script stops: raise `package.json`'s version first.
2. In parallel: `release-linux` (AppImage, deb, rpm), `release-mac` (dmg, zip for arm64 and x64, ad-hoc signed) and `release-docker` (`ghcr.io/hpmartini/devhub-api` and `-frontend` for amd64/arm64 tagged with the version, plus the compose file pinned to it and `init-db.sql`). `latest` images stay with final releases.
3. `release-publish` publishes the draft as pre-release once all three succeeded, so updaters never see an rc without its `*-mac.yml`.

**Release assets:** besides the installers each build uploads `latest*.yml`/`rc*.yml` and `*.blockmap` (`scripts/release/upload-assets.sh` → `release-assets.sh`); `release-mac` builds arm64 and x64 separately and uploads one `*-mac.yml` merged by `scripts/release/merge-mac-yml.mjs`.

**Woodpecker setup** (once):

- Secret `github_token`: a GitHub PAT for `hpmartini/Orkumo` with `contents: write` and `write:packages` (GHCR).
- Repository setting "Trusted" → Security: `release-docker` runs `tonistiigi/binfmt` and `plugin-docker-buildx` privileged.
- A macOS agent with the local backend for `release-mac` (labels `backend=local`, `platform=darwin/arm64` are automatic): `scripts/release/mac-agent/install.sh` downloads the agent matching the server version (checksum verified), copies the agent secret from the CI host over ssh into `~/.local/share/woodpecker-agent/agent.env` (mode 600) and loads the LaunchAgent `com.orkumo.woodpecker-agent` (log `~/.local/share/woodpecker-agent/agent.log`). It reaches the server's gRPC through traefik on `woodpecker-grpc-tv94.srv1329780.hstgr.cloud:443` (TLS there, h2c to the server's `:9000`; labels in the CI host's `docker-compose.yml`). `node`, `bun`, `gh` and `git` must be installed. While no Mac agent is online the macOS workflow waits and the draft stays unpublished. Every other workflow is pinned to `backend: docker`, so the Mac never runs containers.

**macOS signing:** the Woodpecker build is ad-hoc (`CSC_IDENTITY_AUTO_DISCOVERY=false`); macOS apps update themselves by bundle swap (see Updates), so `release-mac` must upload both zips and the merged `latest-mac.yml`. With a Developer ID plus notarization (`electron/notarize.js`) Squirrel.Mac takes over and the one-time `xattr -cr` goes away; it needs `CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD` and `APPLE_TEAM_ID` in `release-mac`'s environment and `-c.mac.hardenedRuntime=true -c.mac.entitlements=electron/entitlements.mac.plist -c.mac.entitlementsInherit=electron/entitlements.mac.plist` on its `electron-builder` calls.

## Architecture

The desktop application consists of three main components:

### 1. Main Process (Electron)

- Manages application lifecycle
- Creates and controls windows
- Handles native OS integration
- Spawns and manages the backend server

### 2. Renderer Process (React Frontend)

- Same React application as the web version
- Communicates with backend via HTTP/WebSocket
- Access to limited Electron APIs via preload script

### 3. Backend Server (Express)

- Runs as a forked Node.js process
- Provides REST API and WebSocket server
- Manages process spawning, monitoring, and terminal sessions
- Identical to the web version's backend

## Security

The desktop application implements several security best practices:

- **Context Isolation**: Renderer process cannot directly access Electron/Node.js APIs
- **Preload Script**: Limited, whitelisted APIs exposed via `contextBridge`
- **Sandbox**: Enabled where possible (disabled only for native modules)
- **Content Security Policy**: Prevents XSS and other web vulnerabilities
- **Input Validation**: All user input is validated and sanitized
- **URL Validation**: External URLs are validated to prevent opening dangerous protocols (file://, javascript:, etc.)

### macOS Security Entitlements

The macOS build requires specific security entitlements to support native modules used for terminal emulation and process monitoring. These entitlements weaken some of macOS's security protections but are necessary for the app to function properly:

- **`com.apple.security.cs.allow-jit`**: Required by Node.js for JIT compilation
- **`com.apple.security.cs.allow-unsigned-executable-memory`**: Required by `node-pty` for terminal emulation
- **`com.apple.security.cs.allow-dyld-environment-variables`**: Allows dynamic library loading for native modules
- **`com.apple.security.cs.disable-library-validation`**: Required to load native modules (node-pty, pidusage) that aren't signed by Apple

**Security Trade-offs:**

- These entitlements are required for terminal functionality and process monitoring
- Without them, the app cannot spawn terminal sessions or monitor CPU/memory usage
- The entitlements are standard for Electron apps that use native Node.js modules
- The attack surface is mitigated by context isolation and input validation

**Why These Are Necessary:**

- `node-pty`: A native module that provides terminal emulation functionality by interfacing with pseudo-terminals at the OS level
- `pidusage`: A native module that reads process information from the system for CPU and memory monitoring

These are essential features of the dashboard and cannot be implemented without native modules. The entitlements file can be found at `electron/entitlements.mac.plist`.

**Mitigation Strategies:**

Despite the required entitlements, the application implements multiple layers of security:

1. **Context Isolation**: The renderer process is fully isolated from Node.js APIs, preventing malicious scripts from accessing system resources
2. **Preload Script Validation**: Only whitelisted APIs are exposed via `contextBridge`, with comprehensive input validation on all IPC handlers
3. **URL Validation**: External URLs are validated to block dangerous protocols (`file://`, `javascript:`, `data:`) - see `electron/validation.js`
4. **Input Sanitization**: All dialog inputs are sanitized with length limits and type validation to prevent injection attacks
5. **Single Instance Lock**: Only one instance of the app can run, preventing multiple simultaneous attack vectors
6. **No Remote Code Execution**: The app does not load remote content or execute dynamically downloaded code
7. **Process Isolation**: The backend server runs as a separate forked process, limiting the impact of potential server vulnerabilities

**User Security Best Practices:**

To minimize security risks when using the desktop application:

- **Download from trusted sources**: Only download the app from the official GitHub releases or verified distribution channels
- **Verify checksums**: Check the SHA256 checksums of downloaded binaries against the official release notes
- **Keep updated**: Install updates promptly to receive security patches
- **Review permissions**: The app requests minimal system permissions - be cautious if it ever requests additional permissions
- **Monitor network activity**: The app only makes network requests to configured project servers

**For Developers:**

If you're building from source or auditing the code:

- Review `electron/main.js` for IPC handler security
- Examine `electron/validation.js` for input validation logic
- Check `electron/preload.js` for exposed API surface
- Inspect `electron/entitlements.mac.plist` for macOS permissions
- Run the test suite: `bun run test` (includes 28 security validation tests)

## Troubleshooting

### macOS Issues

**"App is damaged and can't be opened"**

- This happens when the app isn't properly signed (development builds)
- Solution: Run `xattr -cr /Applications/Orkumo\ Dashboard.app`

**"App can't be opened because Apple cannot check it for malicious software"**

- Right-click the app and select "Open"
- Click "Open" in the dialog that appears

### Linux Issues

**AppImage won't run**

- Make it executable: `chmod +x Orkumo-*.AppImage`
- Install FUSE if needed: `sudo apt install fuse libfuse2` (Ubuntu/Debian)

**Permission denied errors**

- Ensure the app has permission to access your project directories
- Check file permissions and ownership

### General Issues

**Backend server won't start**

- Check if port 3001 is already in use
- View logs in the terminal (development mode) or console (DevTools)

**Database connection failed**

- The app will fall back to file-based storage if PostgreSQL isn't available
- This is normal and expected for most use cases

**Native module errors**

- Try rebuilding native modules: `bunx electron-rebuild`
- Ensure you're on a supported Node.js version (20.x or higher)

## Environment Variables

The desktop app supports the following environment variables:

### Required

None - the app works out of the box!

### Optional

- `DATABASE_URL`: PostgreSQL connection string (optional, uses file storage by default)
- `SERVER_PORT`: Backend server port (default: 3001)
- `NODE_ENV`: Set to `development` for development mode

## Differences from Web Version

### Advantages

✅ No need to manage backend server manually
✅ Native system integration (menus, notifications, dialogs)
✅ Better terminal performance (native modules)
✅ Offline-capable (no internet required after installation)

### Limitations

⚠️ Larger download size (~100-150 MB vs web version)
⚠️ Platform-specific builds required
⚠️ Memory usage slightly higher than web version

## API origin policy (CORS)

The backend listens on `127.0.0.1` only (Docker: every interface; `DEVORBIT_LISTEN_HOST` opts in to another address) and answers browser requests from loopback origins (`localhost`, `127.0.0.1`, `[::1]`, any port). Add more with `CORS_ORIGINS=https://a.example,https://b.example`.

The packaged app loads the UI via `file://`, which sends `Origin: null` (fetch) and `file://` (WebSocket). Those origins, which any sandboxed iframe or local file can send too, are accepted only with the per-launch secret the Electron main process adds as `X-Orkumo-Renderer` to the main and quick windows' top-frame requests (`electron/rendererSecret.js`, server env `DEVORBIT_RENDERER_SECRET`); the built-in browser and frames inside the app never get it.

## Contributing

Contributions to the desktop application are welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

### Development Setup

1. Fork and clone the repository
2. Install dependencies: `bun install`
3. Make your changes
4. Test in development: `bun run electron:dev`
5. Test builds: `bun run electron:build`
6. Submit a pull request

## Roadmap

Planned features for the desktop application:

- [ ] System tray integration with quick actions
- [ ] Native notifications for process events
- [ ] Deep linking (`devorbit://` protocol)
- [ ] Global keyboard shortcuts
- [ ] Multi-window support (separate windows per project)
- [ ] Themes and appearance customization
- [ ] Export/import settings

## License

Same as the main project. See [LICENSE](LICENSE) for details.

## Support

For issues and questions:

- **GitHub Issues**: [Report a bug or request a feature](https://github.com/hpmartini/Orkumo/issues)
- **Discussions**: [Ask questions and share ideas](https://github.com/hpmartini/Orkumo/discussions)

---

Made with ❤️ using [Electron](https://www.electronjs.org/)
