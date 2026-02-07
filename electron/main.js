import { app, BrowserWindow, BrowserView, ipcMain, Menu, dialog, shell } from 'electron';
import { fileURLToPath } from 'url';
import path from 'path';
import { fork, spawn } from 'child_process';
import * as fs from 'fs';
import { createServer } from 'net';
import electronUpdater from 'electron-updater';
const { autoUpdater } = electronUpdater;
import { isValidExternalUrl, validateDialogOptions } from './validation.js';
import { APP_NAME } from './constants.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Server process reference
let serverProcess = null;
let mainWindow = null;
let isShuttingDown = false;

// BrowserView instances for embedded browser previews
// Map of viewId -> { view: BrowserView, devToolsWindow: BrowserWindow | null }
const browserViews = new Map();

const isDev = !app.isPackaged;
const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL || 'http://localhost:3000';
const SERVER_PORT = parseInt(process.env.SERVER_PORT || '3001', 10);

/**
 * Create the main application window
 */
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 768,
    backgroundColor: '#0f172a',
    title: APP_NAME,
    // Custom titlebar like Notion/VS Code - tabs are rendered in the titlebar area
    titleBarStyle: 'hidden',
    trafficLightPosition: { x: 12, y: 12 }, // Position macOS traffic lights
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false, // Required for some native modules
      preload: path.join(__dirname, 'preload.js'),
    },
    show: false, // Don't show until ready
  });

  // Show window when ready to avoid flashing
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // Load the app
  if (isDev) {
    mainWindow.loadURL(VITE_DEV_SERVER_URL);
    // Open DevTools in development
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  // Handle external links with URL validation
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isValidExternalUrl(url, isDev)) {
      shell.openExternal(url);
    } else {
      console.warn('[Electron] Blocked attempt to open invalid URL:', url);
    }
    return { action: 'deny' };
  });

  // Handle window close
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Create application menu
  createApplicationMenu();
}

/**
 * Create application menu
 */
function createApplicationMenu() {
  const template = [
    {
      label: 'File',
      submenu: [
        {
          label: 'Refresh',
          accelerator: 'CmdOrCtrl+R',
          click: () => {
            if (mainWindow) {
              mainWindow.reload();
            }
          },
        },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Window',
      submenu: [{ role: 'minimize' }, { role: 'zoom' }, { type: 'separator' }, { role: 'front' }],
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'Documentation',
          click: () => {
            shell.openExternal('https://github.com/hpmartini/DevHub');
          },
        },
        {
          label: 'Report Issue',
          click: () => {
            shell.openExternal('https://github.com/hpmartini/DevHub/issues');
          },
        },
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

/**
 * Check if a port is available
 */
async function isPortAvailable(port) {
  return new Promise((resolve) => {
    const server = createServer();
    let resolved = false;

    // Set a timeout to prevent hanging indefinitely
    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        console.warn(`[Electron] Port check timeout for port ${port}`);
        server.close();
        resolve(false);
      }
    }, 5000);

    server.once('error', (err) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        if (err.code === 'EADDRINUSE') {
          console.log(`[Electron] Port ${port} is already in use`);
        } else {
          console.warn(`[Electron] Port check error for port ${port}:`, err.code, err.message);
        }
        resolve(false);
      }
    });

    server.once('listening', () => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        server.close();
        resolve(true);
      }
    });

    server.listen(port, '127.0.0.1');
  });
}

/**
 * Check if the backend server is ready by polling health endpoint
 */
async function waitForServerReady(maxAttempts = 60, delayMs = 500) {
  const serverUrl = `http://localhost:${SERVER_PORT}`;

  console.log(`[Electron] Waiting for server to be ready at ${serverUrl}/api/health...`);

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await fetch(`${serverUrl}/api/health`);
      if (response && response.ok) {
        const data = await response.json().catch(() => ({}));
        console.log(`[Electron] Backend server ready after ${attempt * delayMs}ms`, data);
        return true;
      } else {
        console.log(
          `[Electron] Health check attempt ${attempt}/${maxAttempts}: status=${response?.status}`
        );
      }
    } catch (error) {
      // Server not ready yet, continue polling
      if (attempt % 10 === 0) {
        console.log(`[Electron] Health check attempt ${attempt}/${maxAttempts}: ${error.message}`);
      }
    }

    // Wait before next attempt
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  throw new Error(`Server failed to become ready after ${maxAttempts * delayMs}ms`);
}

/**
 * Start the backend server
 */
async function startBackendServer() {
  console.log('[Electron] Starting backend server...');
  console.log('[Electron] isDev:', isDev);
  console.log('[Electron] resourcesPath:', process.resourcesPath);

  // Check if port is available
  const portAvailable = await isPortAvailable(SERVER_PORT);
  if (!portAvailable) {
    throw new Error(
      `Port ${SERVER_PORT} is already in use. Please close the application using this port and try again.\n\n` +
        `Common solutions:\n` +
        `- Check if another instance of ${APP_NAME} is running\n` +
        `- Check for other applications using port ${SERVER_PORT}\n` +
        `- Kill the process: lsof -ti:${SERVER_PORT} | xargs kill -9 (macOS/Linux)`
    );
  }

  const serverPath = isDev
    ? path.join(__dirname, '../server/index.js')
    : path.join(process.resourcesPath, 'app.asar.unpacked', 'dist-server/index.js');

  console.log('[Electron] Server path:', serverPath);

  // Check if server file exists
  if (!fs.existsSync(serverPath)) {
    throw new Error(`Server file not found at: ${serverPath}`);
  }

  // In production, we need to set up proper module resolution
  // The bundled server runs from app.asar.unpacked/dist-server
  const serverCwd = isDev
    ? path.join(__dirname, '..')
    : path.join(process.resourcesPath, 'app.asar.unpacked', 'dist-server');

  // Add the asar path to NODE_PATH so the server can find its dependencies
  const asarNodeModules = isDev ? '' : path.join(process.resourcesPath, 'app.asar', 'node_modules');

  // Also add unpacked node_modules for native modules like node-pty
  const unpackedNodeModules = isDev
    ? ''
    : path.join(process.resourcesPath, 'app.asar.unpacked', 'node_modules');

  const nodePaths = [asarNodeModules, unpackedNodeModules, process.env.NODE_PATH || '']
    .filter(Boolean)
    .join(path.delimiter);

  console.log('[Electron] Server CWD:', serverCwd);
  console.log('[Electron] NODE_PATH:', nodePaths);

  // Build enhanced PATH that includes common Node.js installation paths
  // Electron apps don't inherit the user's shell PATH, so we need to add these manually
  // Use multiple fallbacks for HOME since Electron might not have it set
  const homeDir =
    process.env.HOME || process.env.USERPROFILE || `/Users/${process.env.USER}` || '/Users';
  const nvmDir = process.env.NVM_DIR || `${homeDir}/.nvm`;

  console.log('[Electron] HOME:', homeDir);
  console.log('[Electron] NVM_DIR:', nvmDir);

  // Scan for NVM node versions
  const nvmNodePaths = [];
  try {
    const nvmVersionsPath = `${nvmDir}/versions/node`;
    console.log('[Electron] Checking NVM path:', nvmVersionsPath);
    if (fs.existsSync(nvmVersionsPath)) {
      const versions = fs.readdirSync(nvmVersionsPath);
      console.log('[Electron] Found NVM versions:', versions);
      versions
        .sort()
        .reverse()
        .forEach((v) => {
          const binPath = `${nvmVersionsPath}/${v}/bin`;
          if (fs.existsSync(binPath)) {
            nvmNodePaths.push(binPath);
          }
        });
    } else {
      console.log('[Electron] NVM versions path does not exist');
    }
  } catch (err) {
    console.error('[Electron] Error scanning NVM versions:', err);
  }

  // NVM paths MUST come first to override any Homebrew node installation
  // This ensures NVM's node is used while other homebrew binaries (like code-server) remain accessible
  const additionalPaths = [
    ...nvmNodePaths, // NVM versioned paths first (e.g., ~/.nvm/versions/node/v20.x.x/bin)
    `${nvmDir}/current/bin`, // NVM current symlink
    `${homeDir}/.volta/bin`,
    `${homeDir}/.asdf/shims`,
    `${homeDir}/.bun/bin`,
    `${homeDir}/Library/pnpm`,
    '/usr/local/bin',
    '/usr/bin',
    '/bin',
  ].filter((p) => p && fs.existsSync(p));

  // Filter out problematic paths from inherited PATH
  // Only exclude node-specific paths - keep /opt/homebrew/bin for other binaries like code-server
  const filteredInheritedPath = (process.env.PATH || '')
    .split(':')
    .filter((p) => {
      if (!p) return false;
      // Exclude Homebrew's node-specific paths (NVM paths come first anyway)
      if (p.includes('homebrew/Cellar/node')) return false;
      if (p.includes('homebrew/opt/node')) return false;
      return true;
    })
    .join(':');

  const enhancedPath = [...additionalPaths, filteredInheritedPath].filter(Boolean).join(':');

  console.log('[Electron] Enhanced PATH (first 5):', enhancedPath.split(':').slice(0, 5).join(':'));
  console.log('[Electron] NVM paths found:', nvmNodePaths.length);

  // Get the user data path for persistent storage
  // This path persists across app updates (outside the app bundle)
  const userDataPath = app.getPath('userData');
  const dataPath = path.join(userDataPath, 'data');

  console.log('[Electron] User data path:', userDataPath);
  console.log('[Electron] Data storage path:', dataPath);

  // Ensure data directory exists
  if (!fs.existsSync(dataPath)) {
    fs.mkdirSync(dataPath, { recursive: true });
  }

  // Migrate data from old location (inside app bundle) to new persistent location
  // This is needed for users upgrading from versions that stored data inside the app
  if (!isDev) {
    const oldDataPath = path.join(process.resourcesPath, 'data');
    const migrationMarker = path.join(dataPath, '.migrated');

    if (!fs.existsSync(migrationMarker) && fs.existsSync(oldDataPath)) {
      console.log('[Electron] Migrating data from old location:', oldDataPath);
      const filesToMigrate = ['config.json', 'settings.json', 'custom-ides.json'];

      for (const file of filesToMigrate) {
        const oldFile = path.join(oldDataPath, file);
        const newFile = path.join(dataPath, file);

        if (fs.existsSync(oldFile) && !fs.existsSync(newFile)) {
          try {
            const content = fs.readFileSync(oldFile, 'utf-8');
            fs.writeFileSync(newFile, content);
            console.log(`[Electron] Migrated ${file}`);
          } catch (err) {
            console.error(`[Electron] Failed to migrate ${file}:`, err);
          }
        }
      }

      // Create migration marker
      fs.writeFileSync(
        migrationMarker,
        JSON.stringify(
          {
            migratedAt: new Date().toISOString(),
            oldPath: oldDataPath,
            newPath: dataPath,
          },
          null,
          2
        )
      );
      console.log('[Electron] Data migration complete');
    }
  }

  // Set environment variables for server
  const env = {
    ...process.env,
    PATH: enhancedPath,
    SERVER_PORT: String(SERVER_PORT),
    NODE_ENV: isDev ? 'development' : 'production',
    ELECTRON_MODE: 'true',
    NODE_PATH: nodePaths,
    DEVORBIT_DATA_PATH: dataPath, // Pass userData path to server for persistent storage
  };

  // Store server output for debugging
  let serverOutput = '';

  serverProcess = fork(serverPath, [], {
    env,
    stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
    cwd: serverCwd,
  });

  // Capture stdout
  serverProcess.stdout?.on('data', (data) => {
    const output = data.toString();
    serverOutput += output;
    console.log('[Server]', output.trim());
  });

  // Capture stderr
  serverProcess.stderr?.on('data', (data) => {
    const output = data.toString();
    serverOutput += output;
    console.error('[Server Error]', output.trim());
  });

  serverProcess.on('error', (error) => {
    console.error('[Electron] Server process error:', error);
    console.error('[Electron] Server output so far:', serverOutput);
    throw error;
  });

  serverProcess.on('exit', (code, signal) => {
    console.log(`[Electron] Server process exited with code ${code}, signal ${signal}`);
    if (serverOutput) {
      console.log('[Electron] Server output:', serverOutput.slice(-2000));
    }

    // If server crashes after startup (code !== 0) and window exists, show error
    // Don't show error if we're in the process of shutting down
    if (code !== 0 && code !== null && !isShuttingDown && mainWindow && !mainWindow.isDestroyed()) {
      console.error(`[Electron] Server crashed with exit code ${code}`);
      dialog.showMessageBox(mainWindow, {
        type: 'error',
        title: 'Backend Server Crashed',
        message: 'The backend server has unexpectedly crashed.',
        detail:
          `Exit code: ${code}\n\n` +
          `Server output:\n${serverOutput.slice(-1000)}\n\n` +
          `The application may not function correctly. Please restart the application.`,
        buttons: ['OK'],
      });
    }
  });

  // Wait for server to be ready by polling health endpoint
  await waitForServerReady();
  console.log('[Electron] Backend server started on port', SERVER_PORT);
}

/**
 * Stop the backend server
 */
function stopBackendServer() {
  if (!serverProcess || isShuttingDown) {
    return; // Early return if already shutting down or no process
  }

  isShuttingDown = true;
  console.log('[Electron] Stopping backend server...');

  // Capture the process reference and clear it immediately to prevent multiple calls
  const processToKill = serverProcess;
  serverProcess = null;

  processToKill.kill('SIGTERM');

  // Set a timeout to forcefully kill the process if it doesn't exit within 5 seconds
  const killTimer = setTimeout(() => {
    if (processToKill && processToKill.exitCode === null) {
      console.warn('[Electron] Server did not exit gracefully, sending SIGKILL...');
      processToKill.kill('SIGKILL');
    }
  }, 5000);

  // Clear timeout if process exits before 5 seconds to prevent unnecessary SIGKILL
  processToKill.once('exit', () => clearTimeout(killTimer));
}

/**
 * IPC Handlers
 */
function setupIpcHandlers() {
  // Handle opening external links with URL validation
  ipcMain.handle('open-external', async (event, url) => {
    if (!url || typeof url !== 'string') {
      return { success: false, error: 'Invalid URL provided' };
    }

    if (!isValidExternalUrl(url, isDev)) {
      console.warn('[Electron] Blocked attempt to open invalid URL:', url);
      return {
        success: false,
        error: 'URL validation failed: Only http:// and https:// URLs are allowed',
      };
    }

    try {
      await shell.openExternal(url);
      return { success: true };
    } catch (error) {
      console.error('[Electron] Failed to open external URL:', error);
      return { success: false, error: error.message };
    }
  });

  // Handle showing native dialogs with input validation
  ipcMain.handle('show-message-box', async (event, options) => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      return { success: false, error: 'Main window not available' };
    }

    try {
      const sanitizedOptions = validateDialogOptions(options, 'messageBox');
      const result = await dialog.showMessageBox(mainWindow, sanitizedOptions);
      return { success: true, ...result };
    } catch (error) {
      console.error('[Electron] Dialog error:', error);
      return { success: false, error: error.message };
    }
  });

  // Handle opening directory picker with input validation
  ipcMain.handle('show-open-dialog', async (event, options) => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      return { success: false, error: 'Main window not available' };
    }

    try {
      const sanitizedOptions = validateDialogOptions(options, 'openDialog');
      const result = await dialog.showOpenDialog(mainWindow, sanitizedOptions);
      return { success: true, ...result };
    } catch (error) {
      console.error('[Electron] Dialog error:', error);
      return { success: false, error: error.message };
    }
  });

  // Get app version
  ipcMain.handle('get-app-version', () => {
    return app.getVersion();
  });

  // Get platform info
  ipcMain.handle('get-platform', () => {
    return {
      platform: process.platform,
      arch: process.arch,
      version: process.version,
    };
  });

  // Check for updates manually
  ipcMain.handle('check-for-updates', async () => {
    if (isDev) {
      return {
        success: true,
        updateAvailable: false,
        message: 'Update checking is disabled in development mode',
      };
    }

    try {
      const result = await autoUpdater.checkForUpdates();
      return {
        success: true,
        updateAvailable: result && result.updateInfo,
        version: result?.updateInfo?.version,
      };
    } catch (error) {
      console.error('[Electron] Update check failed:', error);
      return { success: false, error: error.message };
    }
  });

  // Install update and restart
  ipcMain.handle('install-update', () => {
    if (isDev) {
      return { success: false, error: 'Update installation is disabled in development mode' };
    }
    try {
      autoUpdater.quitAndInstall(false, true);
      return { success: true };
    } catch (error) {
      console.error('[Electron] Update installation failed:', error);
      return { success: false, error: error.message };
    }
  });

  // ============================================
  // BrowserView IPC Handlers for embedded browser preview
  // ============================================

  // Create a new BrowserView
  ipcMain.handle('browser-view-create', async (event, { viewId, bounds }) => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      return { success: false, error: 'Main window not available' };
    }

    if (browserViews.has(viewId)) {
      return { success: false, error: 'View already exists' };
    }

    try {
      const view = new BrowserView({
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true,
        },
      });

      // Set bounds
      view.setBounds({
        x: Math.round(bounds.x),
        y: Math.round(bounds.y),
        width: Math.round(bounds.width),
        height: Math.round(bounds.height),
      });

      // Enable auto-resize to match parent window
      view.setAutoResize({ width: false, height: false, horizontal: false, vertical: false });

      // Add to main window
      mainWindow.addBrowserView(view);

      // Store reference
      browserViews.set(viewId, { view, devToolsWindow: null });

      console.log(`[BrowserView] Created view ${viewId} with bounds:`, bounds);
      return { success: true };
    } catch (error) {
      console.error(`[BrowserView] Failed to create view ${viewId}:`, error);
      return { success: false, error: error.message };
    }
  });

  // Navigate BrowserView to URL
  ipcMain.handle('browser-view-navigate', async (event, { viewId, url }) => {
    const entry = browserViews.get(viewId);
    if (!entry) {
      return { success: false, error: 'View not found' };
    }

    try {
      // Validate URL - only allow http/https localhost URLs
      const parsed = new URL(url);
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        return { success: false, error: 'Only http and https protocols are allowed' };
      }

      // For security, only allow localhost URLs in the browser preview
      const hostname = parsed.hostname.toLowerCase();
      if (!['localhost', '127.0.0.1', '0.0.0.0', '::1'].includes(hostname)) {
        return { success: false, error: 'Only localhost URLs are allowed in browser preview' };
      }

      await entry.view.webContents.loadURL(url);
      console.log(`[BrowserView] Navigated view ${viewId} to ${url}`);
      return { success: true };
    } catch (error) {
      console.error(`[BrowserView] Failed to navigate view ${viewId}:`, error);
      return { success: false, error: error.message };
    }
  });

  // Resize/reposition BrowserView
  ipcMain.handle('browser-view-resize', async (event, { viewId, bounds }) => {
    const entry = browserViews.get(viewId);
    if (!entry) {
      return { success: false, error: 'View not found' };
    }

    try {
      entry.view.setBounds({
        x: Math.round(bounds.x),
        y: Math.round(bounds.y),
        width: Math.round(bounds.width),
        height: Math.round(bounds.height),
      });
      return { success: true };
    } catch (error) {
      console.error(`[BrowserView] Failed to resize view ${viewId}:`, error);
      return { success: false, error: error.message };
    }
  });

  // Destroy BrowserView
  ipcMain.handle('browser-view-destroy', async (event, { viewId }) => {
    const entry = browserViews.get(viewId);
    if (!entry) {
      return { success: false, error: 'View not found' };
    }

    try {
      // Close DevTools window if open
      if (entry.devToolsWindow && !entry.devToolsWindow.isDestroyed()) {
        entry.devToolsWindow.close();
      }

      // Remove from main window and destroy
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.removeBrowserView(entry.view);
      }

      browserViews.delete(viewId);
      console.log(`[BrowserView] Destroyed view ${viewId}`);
      return { success: true };
    } catch (error) {
      console.error(`[BrowserView] Failed to destroy view ${viewId}:`, error);
      return { success: false, error: error.message };
    }
  });

  // Open DevTools for BrowserView
  ipcMain.handle('browser-view-open-devtools', async (event, { viewId }) => {
    const entry = browserViews.get(viewId);
    if (!entry) {
      return { success: false, error: 'View not found' };
    }

    try {
      // If DevTools window already exists and is open, focus it
      if (entry.devToolsWindow && !entry.devToolsWindow.isDestroyed()) {
        entry.devToolsWindow.focus();
        return { success: true };
      }

      // Create a new window for DevTools
      const devToolsWindow = new BrowserWindow({
        width: 800,
        height: 600,
        title: 'DevTools - Browser Preview',
        autoHideMenuBar: true,
      });

      // Open DevTools in the new window
      entry.view.webContents.setDevToolsWebContents(devToolsWindow.webContents);
      entry.view.webContents.openDevTools({ mode: 'detach' });

      // Store reference
      entry.devToolsWindow = devToolsWindow;

      // Clean up when DevTools window is closed
      devToolsWindow.on('closed', () => {
        if (browserViews.has(viewId)) {
          browserViews.get(viewId).devToolsWindow = null;
        }
      });

      console.log(`[BrowserView] Opened DevTools for view ${viewId}`);
      return { success: true };
    } catch (error) {
      console.error(`[BrowserView] Failed to open DevTools for view ${viewId}:`, error);
      return { success: false, error: error.message };
    }
  });

  // Close DevTools for BrowserView
  ipcMain.handle('browser-view-close-devtools', async (event, { viewId }) => {
    const entry = browserViews.get(viewId);
    if (!entry) {
      return { success: false, error: 'View not found' };
    }

    try {
      if (entry.devToolsWindow && !entry.devToolsWindow.isDestroyed()) {
        entry.devToolsWindow.close();
        entry.devToolsWindow = null;
      }
      entry.view.webContents.closeDevTools();
      console.log(`[BrowserView] Closed DevTools for view ${viewId}`);
      return { success: true };
    } catch (error) {
      console.error(`[BrowserView] Failed to close DevTools for view ${viewId}:`, error);
      return { success: false, error: error.message };
    }
  });

  // Refresh BrowserView
  ipcMain.handle('browser-view-refresh', async (event, { viewId }) => {
    const entry = browserViews.get(viewId);
    if (!entry) {
      return { success: false, error: 'View not found' };
    }

    try {
      entry.view.webContents.reload();
      console.log(`[BrowserView] Refreshed view ${viewId}`);
      return { success: true };
    } catch (error) {
      console.error(`[BrowserView] Failed to refresh view ${viewId}:`, error);
      return { success: false, error: error.message };
    }
  });

  // Check if running in Electron
  ipcMain.handle('is-electron', () => {
    return true;
  });
}

/**
 * Setup auto-updater
 */
function setupAutoUpdater() {
  // Don't check for updates in development
  if (isDev) {
    console.log('[Electron] Auto-update disabled in development mode');
    return;
  }

  // Configure auto-updater
  autoUpdater.autoDownload = false; // Don't download automatically, ask user first
  autoUpdater.autoInstallOnAppQuit = true;

  // Update available
  autoUpdater.on('update-available', (info) => {
    console.log('[Electron] Update available:', info.version);

    if (mainWindow && !mainWindow.isDestroyed()) {
      dialog
        .showMessageBox(mainWindow, {
          type: 'info',
          title: 'Update Available',
          message: `A new version (${info.version}) is available!`,
          detail:
            'Would you like to download it now? The update will be installed when you restart the application.',
          buttons: ['Download', 'Later'],
          defaultId: 0,
          cancelId: 1,
        })
        .then((result) => {
          if (result.response === 0) {
            // User clicked "Download"
            autoUpdater.downloadUpdate();
          }
        });
    }
  });

  // Update not available
  autoUpdater.on('update-not-available', (info) => {
    console.log('[Electron] No update available:', info.version);
  });

  // Update download progress
  autoUpdater.on('download-progress', (progressObj) => {
    const logMessage = `Download speed: ${progressObj.bytesPerSecond} - Downloaded ${progressObj.percent}%`;
    console.log('[Electron]', logMessage);

    // Send progress to renderer if needed
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('download-progress', progressObj);
    }
  });

  // Update downloaded
  autoUpdater.on('update-downloaded', (info) => {
    console.log('[Electron] Update downloaded:', info.version);

    if (mainWindow && !mainWindow.isDestroyed()) {
      dialog
        .showMessageBox(mainWindow, {
          type: 'info',
          title: 'Update Ready',
          message: 'Update downloaded successfully!',
          detail:
            'The update will be installed when you restart the application. Would you like to restart now?',
          buttons: ['Restart Now', 'Later'],
          defaultId: 0,
          cancelId: 1,
        })
        .then((result) => {
          if (result.response === 0) {
            // User clicked "Restart Now"
            autoUpdater.quitAndInstall(false, true);
          }
        });
    }
  });

  // Update error
  autoUpdater.on('error', (error) => {
    console.error('[Electron] Update error:', error);

    // Don't show dialog for expected errors (no releases, network issues, missing config on dev builds)
    const ignoredErrors = [
      'No published versions on GitHub',
      'net::ERR_INTERNET_DISCONNECTED',
      'net::ERR_NETWORK_CHANGED',
      'ENOENT', // Missing app-update.yml (dev/local builds)
      'app-update.yml', // Missing update config file
      'Cannot find channel',
    ];
    const shouldIgnore = ignoredErrors.some((msg) => error.message?.includes(msg));

    if (!shouldIgnore && mainWindow && !mainWindow.isDestroyed()) {
      dialog.showMessageBox(mainWindow, {
        type: 'error',
        title: 'Update Error',
        message: 'Failed to check for updates',
        detail: error.message,
        buttons: ['OK'],
      });
    }
  });

  // Check for updates on startup (after a delay to let the app settle)
  setTimeout(() => {
    console.log('[Electron] Checking for updates...');
    autoUpdater.checkForUpdates().catch((error) => {
      console.error('[Electron] Failed to check for updates:', error);
    });
  }, 5000); // Check 5 seconds after app starts
}

/**
 * App lifecycle
 */

// This method will be called when Electron has finished initialization
app.whenReady().then(async () => {
  try {
    // Start backend server first
    await startBackendServer();

    // Setup IPC handlers
    setupIpcHandlers();

    // Create main window
    createWindow();

    // Setup auto-updater (after window is created)
    setupAutoUpdater();

    // On macOS, recreate window when dock icon is clicked
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
      }
    });
  } catch (error) {
    console.error('[Electron] Failed to start application:', error);
    dialog
      .showMessageBox({
        type: 'error',
        title: 'Startup Error',
        message: `Failed to start ${APP_NAME}`,
        detail: error.message,
        buttons: ['OK'],
      })
      .catch((err) => console.error('[Electron] Failed to show error dialog:', err))
      .finally(() => app.quit());
  }
});

// Quit when all windows are closed
app.on('window-all-closed', () => {
  // On macOS, keep app running until explicit quit
  if (process.platform !== 'darwin') {
    stopBackendServer();
    app.quit();
  }
});

// Cleanup before quit
app.on('before-quit', () => {
  stopBackendServer();
});

// Handle crashes
app.on('render-process-gone', (event, webContents, details) => {
  console.error('[Electron] Render process gone:', details);
  if (mainWindow && !mainWindow.isDestroyed()) {
    dialog.showMessageBox(mainWindow, {
      type: 'error',
      title: 'Application Crash',
      message: 'The application has crashed.',
      detail: `Reason: ${details.reason}`,
      buttons: ['OK'],
    });
  }
});

// Prevent multiple instances
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) {
        mainWindow.restore();
      }
      mainWindow.focus();
    }
  });
}
