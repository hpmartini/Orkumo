import { app, BrowserWindow, ipcMain, Menu, dialog, shell } from 'electron';
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
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        { type: 'separator' },
        { role: 'front' },
      ],
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
        console.log(`[Electron] Health check attempt ${attempt}/${maxAttempts}: status=${response?.status}`);
      }
    } catch (error) {
      // Server not ready yet, continue polling
      if (attempt % 10 === 0) {
        console.log(`[Electron] Health check attempt ${attempt}/${maxAttempts}: ${error.message}`);
      }
    }

    // Wait before next attempt
    await new Promise(resolve => setTimeout(resolve, delayMs));
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
    : path.join(process.resourcesPath, 'server/index.js');

  console.log('[Electron] Server path:', serverPath);

  // Check if server file exists
  if (!fs.existsSync(serverPath)) {
    throw new Error(`Server file not found at: ${serverPath}`);
  }

  // In production, we need to set up proper module resolution
  // The server runs from extraResources/server, and node_modules are in app.asar
  const serverCwd = isDev
    ? path.join(__dirname, '..')
    : process.resourcesPath;

  // Add the asar path to NODE_PATH so the server can find its dependencies
  const asarNodeModules = isDev
    ? ''
    : path.join(process.resourcesPath, 'app.asar', 'node_modules');

  // Also add unpacked node_modules for native modules like node-pty
  const unpackedNodeModules = isDev
    ? ''
    : path.join(process.resourcesPath, 'app.asar.unpacked', 'node_modules');

  const nodePaths = [asarNodeModules, unpackedNodeModules, process.env.NODE_PATH || '']
    .filter(Boolean)
    .join(path.delimiter);

  console.log('[Electron] Server CWD:', serverCwd);
  console.log('[Electron] NODE_PATH:', nodePaths);

  // Set environment variables for server
  const env = {
    ...process.env,
    SERVER_PORT: String(SERVER_PORT),
    NODE_ENV: isDev ? 'development' : 'production',
    ELECTRON_MODE: 'true',
    NODE_PATH: nodePaths,
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
        detail: `Exit code: ${code}\n\n` +
          `Server output:\n${serverOutput.slice(-1000)}\n\n` +
          `The application may not function correctly. Please restart the application.`,
        buttons: ['OK']
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
      return { success: false, error: 'URL validation failed: Only http:// and https:// URLs are allowed' };
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
      return { success: true, updateAvailable: false, message: 'Update checking is disabled in development mode' };
    }

    try {
      const result = await autoUpdater.checkForUpdates();
      return {
        success: true,
        updateAvailable: result && result.updateInfo,
        version: result?.updateInfo?.version
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
      dialog.showMessageBox(mainWindow, {
        type: 'info',
        title: 'Update Available',
        message: `A new version (${info.version}) is available!`,
        detail: 'Would you like to download it now? The update will be installed when you restart the application.',
        buttons: ['Download', 'Later'],
        defaultId: 0,
        cancelId: 1
      }).then((result) => {
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
      dialog.showMessageBox(mainWindow, {
        type: 'info',
        title: 'Update Ready',
        message: 'Update downloaded successfully!',
        detail: 'The update will be installed when you restart the application. Would you like to restart now?',
        buttons: ['Restart Now', 'Later'],
        defaultId: 0,
        cancelId: 1
      }).then((result) => {
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

    // Don't show dialog for expected errors (no releases, network issues on first run)
    const ignoredErrors = [
      'No published versions on GitHub',
      'net::ERR_INTERNET_DISCONNECTED',
      'net::ERR_NETWORK_CHANGED',
    ];
    const shouldIgnore = ignoredErrors.some(msg => error.message?.includes(msg));

    if (!shouldIgnore && mainWindow && !mainWindow.isDestroyed()) {
      dialog.showMessageBox(mainWindow, {
        type: 'error',
        title: 'Update Error',
        message: 'Failed to check for updates',
        detail: error.message,
        buttons: ['OK']
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
    dialog.showMessageBox({
      type: 'error',
      title: 'Startup Error',
      message: `Failed to start ${APP_NAME}`,
      detail: error.message,
      buttons: ['OK']
    })
      .catch(err => console.error('[Electron] Failed to show error dialog:', err))
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
      buttons: ['OK']
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
