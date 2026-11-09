'use strict'

import {app, BrowserWindow, Menu, protocol} from 'electron'
import {createProtocol, installVueDevtools} from 'vue-cli-plugin-electron-builder/lib'
import {MainModelClass} from "./models/MainModelClass";
import {execSync} from 'child_process'
import {sync as commandExistsSync} from 'command-exists'
import clc from 'cli-color'

const isDevelopment = process.env.NODE_ENV !== 'production';


/*----------------------------------
Check are ffmpeg & mg installed?
----------------------------------*/
/*if (!commandExistsSync('ffmpeg')) {
  console.log(clc.red.bold("\nffmpeg") + clc.yellow(" - is not installed. Let me fix it!"));
  console.log(execSync("sudo apt-get update -y && sudo apt-get install ffmpeg -y").toString());
}

if (!commandExistsSync('gm')) {
  console.log(clc.red.bold("\ngm") + clc.yellow(" - is not installed. Let me fix it!"));
  console.log(execSync("sudo apt-get update -y && sudo apt-get install graphicsmagick -y").toString());
}*/

/*----------------------------------
Main logic
----------------------------------*/

// Keep a global reference of the window object, if you don't, the window will
// be closed automatically when the JavaScript object is garbage collected.
let win, MS

// Scheme must be registered before the app is ready
protocol.registerSchemesAsPrivileged([{scheme: 'app', privileges: { secure: true, standard: true } }])

function createWindow () {

  // Create the browser window.
  let opt = { width: 800, height: 600,  webPreferences: {
      nodeIntegration: true
    } };


  if (process.env.WEBPACK_DEV_SERVER_URL) {
    win = new BrowserWindow(opt);

    // Load the url of the dev server if in development mode
    win.loadURL(process.env.WEBPACK_DEV_SERVER_URL)
    if (!process.env.IS_TEST) win.webContents.openDevTools()
  } else {
    opt.webPreferences.devTools = false;
    win = new BrowserWindow(opt);

    createProtocol('app');
    // Load the index.html when not in development
    win.loadURL('app://./index.html');

  }

  MS = new MainModelClass(win);
  MS.init();

  win.on('closed', () => {
    win = null
  })
}

// Quit when all windows are closed.
app.on('window-all-closed', () => {
  // On macOS it is common for applications and their menu bar
  // to stay active until the user quits explicitly with Cmd + Q
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('activate', () => {
  // On macOS it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (win === null) {
    createWindow()
  }
})

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.on('ready', async () => {
  if (isDevelopment && !process.env.IS_TEST) {
    // Install Vue Devtools
    // Devtools extensions are broken in Electron 6.0.0 and greater
    // See https://github.com/nklayman/vue-cli-plugin-electron-builder/issues/378 for more info
    // Electron will not launch with Devtools extensions installed on Windows 10 with dark mode
    // If you are not using Windows 10 dark mode, you may uncomment these lines
    // In addition, if the linked issue is closed, you can upgrade electron and uncomment these lines
    try {
      await installVueDevtools()
    } catch (e) {
      console.error('Vue Devtools failed to install:', e.toString())
    }

  }
  createWindow()
  const menuTemplate = [
    {
      role: 'filemenu'
    },
    {
      role: 'editmenu'
    },
    {
      role: 'viewmenu'
    },
    {
      role: 'windowmenu'
    }
  ];

  let menu = Menu.buildFromTemplate(menuTemplate);
  Menu.setApplicationMenu(menu);
  // console.log(menu);
})

// Exit cleanly on request from parent process in development mode.
if (isDevelopment) {
  if (process.platform === 'win32') {
    process.on('message', data => {
      if (data === 'graceful-exit') {
        app.quit()
      }
    })
  } else {
    process.on('SIGTERM', () => {
      app.quit()
    })
  }
}
