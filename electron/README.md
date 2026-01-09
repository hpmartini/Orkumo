# DevOrbit Dashboard - Electron Desktop Application

This directory contains the Electron implementation for the DevOrbit Dashboard desktop application.

## Architecture

The desktop application uses Electron to wrap the existing React frontend and Express backend into a native desktop application.

### Key Components

- **main.js**: Electron main process that manages the application lifecycle, creates windows, and handles backend server
- **preload.js**: Secure preload script that exposes safe APIs to the renderer process via `contextBridge`
- **electron.d.ts**: TypeScript type definitions for the Electron API
- **notarize.js**: macOS code signing and notarization script
- **entitlements.mac.plist**: macOS security entitlements for native modules

## Development

### Prerequisites

- Node.js 20.x or higher
- npm or yarn
- All dependencies from the main project

### Running in Development Mode

```bash
npm run electron:dev
```

This will:
1. Start the Express backend server on port 3001
2. Start the Vite development server on port 3000
3. Wait for the dev server to be ready
4. Launch Electron with the development window

### Building for Production

#### Build for all platforms
```bash
npm run electron:build:all
```

#### Build for specific platform
```bash
npm run electron:build:mac     # macOS (DMG and ZIP)
npm run electron:build:win     # Windows (NSIS installer and portable)
npm run electron:build:linux   # Linux (AppImage, deb, rpm)
```

Build outputs will be in the `dist-electron/` directory.

## Architecture Details

### Main Process (main.js)

The main process handles:
- Application lifecycle management
- Creating and managing BrowserWindow
- Starting/stopping the Express backend server
- Native menu creation
- IPC communication with renderer
- Single instance lock
- Crash handling

### Backend Integration

The Express backend server is started as a forked Node.js process:
- In **development**: Runs from `server/index.js`
- In **production**: Packaged in `resources/server/` inside the app bundle
- Communicates with frontend via HTTP/WebSocket (same as web version)

### Security

- **Context Isolation**: Enabled to prevent renderer from accessing Node.js/Electron APIs directly
- **Preload Script**: Uses `contextBridge` to expose only safe, whitelisted APIs
- **Sandbox**: Disabled only where necessary for native modules (node-pty, pidusage)
- **Content Security Policy**: Inherited from web version

### Native Modules

The following native modules are used and properly packaged:
- **node-pty**: Terminal emulation (unpacked from ASAR)
- **pidusage**: Process monitoring (unpacked from ASAR)

## Code Signing & Distribution

### macOS

1. **Code Signing**: Requires Apple Developer certificate
2. **Notarization**: Automatic if `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, and `APPLE_TEAM_ID` are set
3. **Distribution**: DMG and ZIP files for both Intel and Apple Silicon

### Windows

1. **Code Signing**: Optional but recommended (requires certificate)
2. **Distribution**: NSIS installer and portable executable

### Linux

1. **Distribution**: AppImage (universal), deb (Debian/Ubuntu), rpm (Fedora/RHEL)

## Auto-Updates

The application is configured for auto-updates via GitHub Releases:
- Uses `electron-builder` auto-update mechanism
- Checks for updates on startup
- Downloads and installs updates in the background
- Notifies user when update is ready

To enable auto-updates, publish releases to GitHub with the built artifacts.

## Environment Variables

The Electron app respects the following environment variables:

- `GEMINI_API_KEY`: AI features API key (from `.env.local`)
- `SERVER_PORT`: Backend server port (default: 3001)
- `DATABASE_URL`: PostgreSQL connection string (optional)

## Troubleshooting

### macOS: "App is damaged" error
This happens when the app isn't properly signed. For development:
```bash
xattr -cr /Applications/DevOrbit\ Dashboard.app
```

### Windows: SmartScreen warning
This is normal for unsigned apps. Users can click "More info" → "Run anyway"

### Linux: Permission denied
Make the AppImage executable:
```bash
chmod +x DevOrbit-Dashboard-1.0.0.AppImage
```

### Native module errors
If you see errors about native modules (node-pty, pidusage):
1. Ensure they're listed in `asarUnpack` in electron-builder.json
2. Rebuild for Electron: `npx electron-rebuild`

## File Structure

```
electron/
├── main.js                    # Electron main process
├── preload.js                 # Preload script (secure IPC bridge)
├── electron.d.ts              # TypeScript definitions
├── notarize.js                # macOS notarization script
├── entitlements.mac.plist     # macOS security entitlements
├── resources/                 # Build resources
│   ├── icon.icns             # macOS icon (TODO: Add actual icon)
│   ├── icon.ico              # Windows icon (TODO: Add actual icon)
│   └── icon.png              # Linux icon (TODO: Add actual icon)
└── README.md                  # This file
```

## Next Steps

1. **Add Application Icons**: Create and add proper icons for all platforms
2. **Implement Auto-Update UI**: Add user-facing update notifications
3. **Add System Tray**: Minimize to system tray functionality
4. **Deep Linking**: Handle `devorbit://` protocol URLs
5. **Native Notifications**: Use system notifications for app events
6. **Menu Bar Enhancements**: Add more menu items (preferences, etc.)
