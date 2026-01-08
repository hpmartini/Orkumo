# DevOrbit Dashboard - Desktop Application

DevOrbit Dashboard is now available as a native desktop application using Electron! This provides a seamless native experience with all the features of the web version.

## Features

✨ **Native Desktop Experience**
- Native window management and system integration
- System tray support (planned)
- Native file dialogs and notifications
- Cross-platform: Windows, macOS, and Linux

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

Download the latest release for your platform from the [Releases](https://github.com/hpmartini/DevHub/releases) page:

- **macOS**: Download `.dmg` file (supports both Intel and Apple Silicon)
- **Windows**: Download `.exe` installer or portable version
- **Linux**: Download `.AppImage`, `.deb`, or `.rpm` based on your distribution

### Building from Source

1. **Clone the repository**
```bash
git clone https://github.com/hpmartini/DevHub.git
cd DevHub
```

2. **Install dependencies**
```bash
npm install
```

3. **Run in development mode**
```bash
npm run electron:dev
```

4. **Build for production**
```bash
# Build for current platform
npm run electron:build

# Build for specific platform
npm run electron:build:mac      # macOS
npm run electron:build:win      # Windows
npm run electron:build:linux    # Linux

# Build for all platforms (requires platform-specific tools)
npm run electron:build:all
```

## Usage

### First Launch

1. **Start the application**
   - macOS: Double-click the app in Applications folder
   - Windows: Run from Start Menu or Desktop shortcut
   - Linux: Run the AppImage or installed application

2. **Configure directories**
   - Open Settings (Admin Panel)
   - Add directories to scan for projects
   - The app will automatically detect and analyze your development projects

3. **Start managing your projects!**
   - View all detected projects
   - Start/stop applications
   - Monitor CPU and memory usage
   - Access terminal sessions
   - Get AI-powered recommendations

### Keyboard Shortcuts

- **Refresh**: `Cmd/Ctrl + R`
- **Toggle DevTools**: `Cmd/Ctrl + Shift + I` (development mode)
- **Quit**: `Cmd/Ctrl + Q`
- **Minimize**: `Cmd/Ctrl + M`
- **Full Screen**: `Cmd/Ctrl + F`

### Development Mode

When running in development mode (`npm run electron:dev`):
- Hot Module Replacement (HMR) is enabled for the frontend
- DevTools are automatically opened
- Backend server runs with live reloading
- Logs are printed to the terminal

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

## Troubleshooting

### macOS Issues

**"App is damaged and can't be opened"**
- This happens when the app isn't properly signed (development builds)
- Solution: Run `xattr -cr /Applications/DevOrbit\ Dashboard.app`

**"App can't be opened because Apple cannot check it for malicious software"**
- Right-click the app and select "Open"
- Click "Open" in the dialog that appears

### Windows Issues

**Windows SmartScreen warning**
- This is normal for unsigned applications
- Click "More info" → "Run anyway"

**Antivirus false positive**
- Some antivirus software may flag Electron apps
- Add an exception for DevOrbit Dashboard

### Linux Issues

**AppImage won't run**
- Make it executable: `chmod +x DevOrbit-Dashboard-*.AppImage`
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
- Try rebuilding native modules: `npx electron-rebuild`
- Ensure you're on a supported Node.js version (20.x or higher)

## Environment Variables

The desktop app supports the following environment variables:

### Required
None - the app works out of the box!

### Optional
- `GEMINI_API_KEY`: Enable AI-powered features (set in `.env.local`)
- `DATABASE_URL`: PostgreSQL connection string (optional, uses file storage by default)
- `SERVER_PORT`: Backend server port (default: 3001)
- `NODE_ENV`: Set to `development` for development mode

## Differences from Web Version

### Advantages
✅ No need to manage backend server manually
✅ Native system integration (menus, notifications, dialogs)
✅ Better terminal performance (native modules)
✅ Offline-capable (no internet required after installation)
✅ Auto-updates (when available)

### Limitations
⚠️ Larger download size (~100-150 MB vs web version)
⚠️ Platform-specific builds required
⚠️ Memory usage slightly higher than web version

## Contributing

Contributions to the desktop application are welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

### Development Setup

1. Fork and clone the repository
2. Install dependencies: `npm install`
3. Make your changes
4. Test in development: `npm run electron:dev`
5. Test builds: `npm run electron:build`
6. Submit a pull request

## Roadmap

Planned features for the desktop application:

- [ ] System tray integration with quick actions
- [ ] Native notifications for process events
- [ ] Deep linking (`devorbit://` protocol)
- [ ] Global keyboard shortcuts
- [ ] Multi-window support (separate windows per project)
- [ ] Auto-update UI improvements
- [ ] Themes and appearance customization
- [ ] Export/import settings

## License

Same as the main project. See [LICENSE](LICENSE) for details.

## Support

For issues and questions:
- **GitHub Issues**: [Report a bug or request a feature](https://github.com/hpmartini/DevHub/issues)
- **Discussions**: [Ask questions and share ideas](https://github.com/hpmartini/DevHub/discussions)

---

Made with ❤️ using [Electron](https://www.electronjs.org/)
