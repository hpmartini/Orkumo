import { app, BrowserWindow, ipcMain, Menu, dialog, shell } from 'electron';
import { fileURLToPath } from 'url';
import path from 'path';
import { fork } from 'child_process';
import * as fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Server process reference
let serverProcess = null;
let mainWindow = null;
let isShuttingDown = false;

const isDev = !app.isPackaged;
const VITE_DEV_SERVER_URL = 'http://localhost:3000';
const SERVER_PORT = 3001;

/**
 * Validate URL to prevent opening dangerous protocols or local files
 * Only allows http:// and https:// URLs
 */
function isValidExternalUrl(urlString) {
  try {
    const url = new URL(urlString);
    // Only allow http and https protocols
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return false;
    }
    // Reject localhost URLs unless in dev mode
    if (!isDev && (url.hostname === 'localhost' || url.hostname === '127.0.0.1')) {
      return false;
    }
    return true;
  } catch (error) {
    // Invalid URL
    return false;
  }
}

/**
 * Validate and sanitize dialog options
 */
function validateDialogOptions(options, type) {
  if (!options || typeof options !== 'object') {
    return {};
  }

  const sanitized = {};

  if (type === 'messageBox') {
    // Validate message box options
    if (options.message && typeof options.message === 'string') {
      sanitized.message = options.message.slice(0, 1000); // Limit message length
    }
    if (options.title && typeof options.title === 'string') {
      sanitized.title = options.title.slice(0, 200);
    }
    if (options.detail && typeof options.detail === 'string') {
      sanitized.detail = options.detail.slice(0, 2000);
    }
    if (options.type && ['none', 'info', 'error', 'question', 'warning'].includes(options.type)) {
      sanitized.type = options.type;
    }
    if (Array.isArray(options.buttons) && options.buttons.length <= 4) {
      sanitized.buttons = options.buttons
        .filter(b => typeof b === 'string')
        .map(b => b.slice(0, 50))
        .slice(0, 4);
    }
  } else if (type === 'openDialog') {
    // Validate open dialog options
    if (options.title && typeof options.title === 'string') {
      sanitized.title = options.title.slice(0, 200);
    }
    if (options.defaultPath && typeof options.defaultPath === 'string') {
      sanitized.defaultPath = options.defaultPath;
    }
    if (options.buttonLabel && typeof options.buttonLabel === 'string') {
      sanitized.buttonLabel = options.buttonLabel.slice(0, 50);
    }
    if (Array.isArray(options.properties)) {
      const validProps = ['openFile', 'openDirectory', 'multiSelections', 'showHiddenFiles',
                          'createDirectory', 'promptToCreate', 'noResolveAliases', 'treatPackageAsDirectory'];
      sanitized.properties = options.properties.filter(p => validProps.includes(p));
    }
  }

  return sanitized;
}

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
    title: 'DevOrbit Dashboard',
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
    if (isValidExternalUrl(url)) {
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
    const server = require('net').createServer();

    server.once('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        resolve(false);
      } else {
        resolve(false);
      }
    });

    server.once('listening', () => {
      server.close();
      resolve(true);
    });

    server.listen(port, '127.0.0.1');
  });
}

/**
 * Check if the backend server is ready by polling health endpoint
 */
async function waitForServerReady(maxAttempts = 30, delayMs = 200) {
  const serverUrl = `http://localhost:${SERVER_PORT}`;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await fetch(`${serverUrl}/api/health`).catch(() => null);
      if (response && response.ok) {
        console.log(`[Electron] Backend server ready after ${attempt * delayMs}ms`);
        return true;
      }
    } catch (error) {
      // Server not ready yet, continue polling
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
  return new Promise(async (resolve, reject) => {
    console.log('[Electron] Starting backend server...');

    // Check if port is available
    const portAvailable = await isPortAvailable(SERVER_PORT);
    if (!portAvailable) {
      const error = new Error(
        `Port ${SERVER_PORT} is already in use. Please close the application using this port and try again.\n\n` +
        `Common solutions:\n` +
        `- Check if another instance of DevOrbit is running\n` +
        `- Check for other applications using port ${SERVER_PORT}\n` +
        `- Kill the process: lsof -ti:${SERVER_PORT} | xargs kill -9 (macOS/Linux)`
      );
      reject(error);
      return;
    }

    const serverPath = isDev
      ? path.join(__dirname, '../server/index.js')
      : path.join(process.resourcesPath, 'server/index.js');

    // Check if server file exists
    if (!fs.existsSync(serverPath)) {
      reject(new Error(`Server file not found at: ${serverPath}`));
      return;
    }

    // Set environment variables for server
    const env = {
      ...process.env,
      SERVER_PORT: String(SERVER_PORT),
      NODE_ENV: isDev ? 'development' : 'production',
      ELECTRON_MODE: 'true',
    };

    // Fork the server process
    try {
      serverProcess = fork(serverPath, [], {
        env,
        stdio: 'inherit',
        cwd: isDev ? path.join(__dirname, '..') : process.resourcesPath,
      });

      serverProcess.on('error', (error) => {
        console.error('[Electron] Server process error:', error);
        reject(error);
      });

      serverProcess.on('exit', (code, signal) => {
        console.log(`[Electron] Server process exited with code ${code}, signal ${signal}`);
        const hadProcess = serverProcess !== null;
        serverProcess = null;

        // If server crashes after startup (code !== 0) and window exists, show error
        if (hadProcess && code !== 0 && code !== null && mainWindow && !mainWindow.isDestroyed()) {
          console.error(`[Electron] Server crashed with exit code ${code}`);
          dialog.showErrorBox(
            'Backend Server Crashed',
            `The backend server has unexpectedly crashed with exit code ${code}.\n\n` +
            `The application may not function correctly. Please restart the application.\n\n` +
            `If this problem persists, check the logs for more information.`
          );
        }
      });

      // Wait for server to be ready by polling health endpoint
      waitForServerReady()
        .then(() => {
          console.log('[Electron] Backend server started on port', SERVER_PORT);
          resolve();
        })
        .catch((error) => {
          console.error('[Electron] Server failed to start:', error);
          reject(error);
        });
    } catch (error) {
      reject(error);
    }
  });
}

/**
 * Stop the backend server
 */
function stopBackendServer() {
  if (serverProcess && !isShuttingDown) {
    isShuttingDown = true;
    console.log('[Electron] Stopping backend server...');
    serverProcess.kill('SIGTERM');
    serverProcess = null;
  }
}

/**
 * IPC Handlers
 */
function setupIpcHandlers() {
  // Handle opening external links with URL validation
  ipcMain.handle('open-external', async (event, url) => {
    if (!url || typeof url !== 'string') {
      throw new Error('Invalid URL provided');
    }

    if (!isValidExternalUrl(url)) {
      console.warn('[Electron] Blocked attempt to open invalid URL:', url);
      throw new Error('URL validation failed: Only http:// and https:// URLs are allowed');
    }

    try {
      await shell.openExternal(url);
      return { success: true };
    } catch (error) {
      console.error('[Electron] Failed to open external URL:', error);
      throw error;
    }
  });

  // Handle showing native dialogs with input validation
  ipcMain.handle('show-message-box', async (event, options) => {
    const sanitizedOptions = validateDialogOptions(options, 'messageBox');
    const result = await dialog.showMessageBox(mainWindow, sanitizedOptions);
    return result;
  });

  // Handle opening directory picker with input validation
  ipcMain.handle('show-open-dialog', async (event, options) => {
    const sanitizedOptions = validateDialogOptions(options, 'openDialog');
    const result = await dialog.showOpenDialog(mainWindow, sanitizedOptions);
    return result;
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

    // On macOS, recreate window when dock icon is clicked
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
      }
    });
  } catch (error) {
    console.error('[Electron] Failed to start application:', error);
    dialog.showErrorBox(
      'Startup Error',
      `Failed to start DevOrbit Dashboard:\n\n${error.message}`
    );
    app.quit();
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
  dialog.showErrorBox(
    'Application Crash',
    `The application has crashed. Reason: ${details.reason}`
  );
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
