const path = require('path');
const { loadProjectDotenv, getCandidatePorts, normalizePort } = require('../src/config/env');

loadProjectDotenv();

const { app, BrowserWindow, Menu, ipcMain, shell } = require('electron');
const { MainModelClass } = require('../src/models/MainModelClass');

const isDevelopment = !app.isPackaged;
if (process.platform === 'linux') {
  app.setDesktopName('360-media-viewer');
}
let mainWindow;
let reactDevtoolsWindow;
let reactDevtoolsMenuItem;
let appModel;

async function loadDevelopmentUrl() {
  const basePort = normalizePort(process.env.DEV_SERVER_PORT, { defaultPort: 5173, portName: 'DEV_SERVER_PORT' });
  const candidatePorts = getCandidatePorts(basePort);

  for (let attempt = 0; attempt < 50; attempt += 1) {
    for (const port of candidatePorts) {
      const url = `http://localhost:${port}`;

      try {
        const response = await fetch(url, { headers: { Accept: 'text/html' } });
        if (!response.ok) {
          continue;
        }

        const html = await response.text();
        if (html.includes('360 Media Viewer') || html.includes('vite/client') || html.includes('/src/main.jsx')) {
          await mainWindow.loadURL(url);
          return;
        }
      } catch (error) {
        // A failed probe is expected while Vite is starting or on an unused port.
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  const rangeEnd = basePort + 4;
  throw new Error(`Unable to find the Vite development server on ports ${basePort}-${rangeEnd}`);
}

async function createReactDevtoolsWindow() {
  if (reactDevtoolsWindow && !reactDevtoolsWindow.isDestroyed()) {
    if (reactDevtoolsMenuItem) {
      reactDevtoolsMenuItem.checked = true;
    }
    reactDevtoolsWindow.focus();
    return;
  }

  reactDevtoolsWindow = new BrowserWindow({
    width: 1000,
    height: 760,
    title: 'React Developer Tools',
    webPreferences: {
      preload: path.join(__dirname, '../devtools/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: true,
    },
  });

  reactDevtoolsWindow.webContents.on('preload-error', (_event, preloadPath, error) => {
    console.error(`React DevTools preload failed (${preloadPath}):`, error);
  });
  reactDevtoolsWindow.webContents.on('console-message', (_event, _level, message) => {
    console.error(`React DevTools: ${message}`);
  });
  reactDevtoolsWindow.on('closed', () => {
    reactDevtoolsWindow = null;
    if (reactDevtoolsMenuItem) {
      reactDevtoolsMenuItem.checked = false;
    }
  });

  await reactDevtoolsWindow.loadFile(path.join(__dirname, '../devtools/react-devtools.html'));

  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch('http://localhost:8097');
      if (response.ok) {
        return;
      }
    } catch (error) {
      // The standalone UI starts its local server after the window loads.
    }

    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  throw new Error('Standalone React DevTools did not start its local server on port 8097');
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 820,
    minWidth: 900,
    minHeight: 640,
    backgroundColor: '#0b1220',
    icon: path.join(__dirname, '../build_resources/icon/png/icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      devTools: isDevelopment,
    },
  });

  if (isDevelopment) {
    await loadDevelopmentUrl();
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    await mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  appModel = new MainModelClass(mainWindow);
  appModel.init();

  mainWindow.on('closed', () => {
    mainWindow = null;
    if (reactDevtoolsWindow && !reactDevtoolsWindow.isDestroyed()) {
      reactDevtoolsWindow.close();
    }
  });
}

app.whenReady().then(async () => {
  if (isDevelopment) {
    try {
      await createReactDevtoolsWindow();
    } catch (error) {
      console.error('Unable to start standalone React DevTools:', error);
    }
  }

  const viewMenu = [
    { role: 'reload' },
    { role: 'forceReload' },
    { role: 'toggleDevTools' },
    { type: 'separator' },
    { role: 'resetZoom' },
    { role: 'zoomIn' },
    { role: 'zoomOut' },
    { type: 'separator' },
    { role: 'togglefullscreen' },
  ];

  if (isDevelopment) {
    viewMenu.push(
      { type: 'separator' },
      {
        id: 'react-devtools-toggle',
        label: 'React Developer Tools',
        type: 'checkbox',
        checked: Boolean(reactDevtoolsWindow && !reactDevtoolsWindow.isDestroyed()),
        click: (menuItem) => {
          if (menuItem.checked) {
            createReactDevtoolsWindow().catch((error) => {
              menuItem.checked = false;
              console.error('Unable to open React DevTools:', error);
            });
          } else if (reactDevtoolsWindow && !reactDevtoolsWindow.isDestroyed()) {
            reactDevtoolsWindow.close();
          }
        },
      }
    );
  }

  const menu = Menu.buildFromTemplate([
    { role: 'fileMenu' },
    { role: 'editMenu' },
    { label: 'View', submenu: viewMenu },
    { role: 'windowMenu' },
    { role: 'help' },
  ]);
  reactDevtoolsMenuItem = menu.getMenuItemById('react-devtools-toggle');
  Menu.setApplicationMenu(menu);

  ipcMain.handle('open-external-url', async (_, url) => {
    try {
      await shell.openExternal(url);
      return true;
    } catch (error) {
      return false;
    }
  });

  await createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      const startWindows = async () => {
        if (isDevelopment) {
          await createReactDevtoolsWindow();
        }
        await createWindow();
      };

      startWindows().catch((error) => console.error('Unable to create application windows:', error));
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

module.exports = { createWindow, isDevelopment, appModel };
