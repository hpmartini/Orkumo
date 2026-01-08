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

const isDev = !app.isPackaged;
const VITE_DEV_SERVER_URL = 'http://localhost:3000';
const SERVER_PORT = 3001;

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

  // Handle external links
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
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
 * Start the backend server
 */
async function startBackendServer() {
  return new Promise((resolve, reject) => {
    console.log('[Electron] Starting backend server...');

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
        serverProcess = null;
      });

      // Wait a bit for server to start
      setTimeout(() => {
        console.log('[Electron] Backend server started on port', SERVER_PORT);
        resolve();
      }, 2000);
    } catch (error) {
      reject(error);
    }
  });
}

/**
 * Stop the backend server
 */
function stopBackendServer() {
  if (serverProcess) {
    console.log('[Electron] Stopping backend server...');
    serverProcess.kill('SIGTERM');
    serverProcess = null;
  }
}

/**
 * IPC Handlers
 */
function setupIpcHandlers() {
  // Handle opening external links
  ipcMain.handle('open-external', async (event, url) => {
    await shell.openExternal(url);
    return { success: true };
  });

  // Handle showing native dialogs
  ipcMain.handle('show-message-box', async (event, options) => {
    const result = await dialog.showMessageBox(mainWindow, options);
    return result;
  });

  // Handle opening directory picker
  ipcMain.handle('show-open-dialog', async (event, options) => {
    const result = await dialog.showOpenDialog(mainWindow, options);
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
