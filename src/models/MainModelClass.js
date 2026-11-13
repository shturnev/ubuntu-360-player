const fs = require('fs');
const express = require('express');
const cors = require('cors');
const path = require('path');
const { dialog, ipcMain } = require('electron');

const { getStorageRoot } = require('../config/env');
const { Helper } = require('./Helper');
const { Media } = require('./Media');
const ConfigModel = require('./ConfigModel');
const Updater = require('./Updater');

const homedir = getStorageRoot();
const clr = require('cli-color');
const trash = require('trash');
const getFolderSize = require('get-folder-size');
const rimraf = require('rimraf');

class MainModelClass {
  constructor(win, updater = new Updater()) {
    this.win = win;
    this.serverUrl = undefined;
    this.homedir = homedir;
    this.static_dir = homedir + '/static';
    this.config = new ConfigModel();
    this.updater = updater;
  }

  init() {
    Helper.checkDir(homedir);
    this.startFileServer();
    this.updater.initialize((channel, payload) => {
      if (this.win && this.win.webContents) this.win.webContents.send(channel, payload);
    });

    ipcMain.on('open-dir', (event) => this.openDir(event));
    ipcMain.on('get-server-url', (event) => event.reply('start-file-server', this.serverUrl));
    ipcMain.on('delete-selected', (event, arg) => this.deleteSelected(arg));
    ipcMain.on('get-media-metadata', async (event, payload) => {
      const origPath = payload?.origPath;
      if (!origPath || !['image', 'video'].includes(payload?.type)) {
        event.reply('media-metadata', { origPath: origPath || '', error: 'Unable to identify this media file.' });
        return;
      }
      try {
        const entries = await Media.getMetadata(origPath, payload.type);
        event.reply('media-metadata', { origPath, entries });
      } catch (error) {
        event.reply('media-metadata', {
          origPath,
          error: error?.message || 'Unable to read media metadata.',
        });
      }
    });
    ipcMain.on('convert-video', async (event, payload) => {
      const inputPath = payload && payload.filePath ? payload.filePath : payload;
      if (!inputPath) {
        event.reply('video-conversion-result', {
          success: false,
          message: 'No video file was provided for conversion.',
        });
        return;
      }

      try {
        const result = await Media.convertVideoFor360(inputPath, this.win);
        event.reply('video-conversion-result', {
          success: true,
          ...result,
        });
      } catch (error) {
        const message = error && error.message ? error.message : 'Unable to convert this video for 360° playback.';
        if (this.win && this.win.webContents) this.win.webContents.send('show-error', new Error(message));
        event.reply('video-conversion-result', {
          success: false,
          origPath: inputPath,
          message,
        });
      }
    });
    ipcMain.on('get-cache-size', (event) => {
      getFolderSize(this.static_dir, (err, size) => {
        const result = err ? 0 : (size / 1024 / 1024).toFixed(2);
        event.reply('cache-size', result);
      });
    });
    ipcMain.on('delete-cache', (event, items) => this.deleteCache(event, items));
    ipcMain.on('get-config', (event) => event.reply('config-data', this.config.getSettings()));
    ipcMain.on('save-config', (event, data) => this.config.loadSettings(data));

    ipcMain.on('check-for-update', (event) => {
      const configData = this.config.getSettings();
      this.updater.check(configData).catch((err) => {
        console.log(clr.red(err));
        event.reply('update-error', {
          message: err && err.message ? err.message : 'Unable to check for updates.',
        });
      });
    });
    ipcMain.on('download-update', (event) => {
      this.updater.download().catch((err) =>
        event.reply('update-error', {
          message: err && err.message ? err.message : 'Unable to download the update.',
        })
      );
    });
    ipcMain.on('install-update', () => this.updater.install());
  }

  startFileServer() {
    const app = express();
    app.use(cors());
    app.use(express.static(homedir + '/static'));
    const server = app.listen(0);

    this.serverUrl = `http://localhost:${server.address().port}/`;
    console.log(`Static file server run on: ${this.serverUrl}`);
    if (this.win && this.win.webContents) {
      this.win.webContents.send('start-file-server', this.serverUrl);
    }
  }

  openDir(event) {
    const options = { properties: ['openDirectory'] };
    const resOpen = dialog.showOpenDialogSync(options);

    if (!resOpen) {
      event.reply('open-dir', false);
      return false;
    }

    event.reply('open-dir', resOpen[0]);
    this.readDir(resOpen[0]);
    return resOpen;
  }

  readDir(pathDir) {
    fs.readdir(pathDir, (err, files) => {
      if (err) {
        if (this.win && this.win.webContents) {
          this.win.webContents.send('show-error', err);
        }
        return;
      }

      Helper.checkDir(this.static_dir + '/small/');
      Helper.checkDir(this.static_dir + '/big/');

      const goodExt = ['jpg', 'jpeg', 'png', 'mp4'];
      const mediaFiles = files.filter((element) => {
        const ext = element.split('.').pop().toLowerCase();
        return goodExt.indexOf(ext) !== -1;
      });

      if (!mediaFiles.length) {
        if (this.win && this.win.webContents) {
          this.win.webContents.send('start-read-dir', 0);
          this.win.webContents.send('open-dir', false);
        }
        return;
      }

      if (this.win && this.win.webContents) this.win.webContents.send('start-read-dir', mediaFiles.length);

      mediaFiles.forEach((file) => {
        const ext = file.split('.').pop().toLowerCase();
        const origPath = pathDir + '/' + file;

        if (ext === 'mp4') {
          Media.saveVideo(origPath, this.win);
        } else {
          Media.saveImage(origPath, this.win);
        }
      });
    });
  }

  deleteSelected(dataArray = []) {
    dataArray.forEach(async (item) => {
      const thumpPath = this.static_dir + '/small/' + item.thumpName;
      const symlPath = this.static_dir + '/big/' + item.bigName;

      if (Helper.isFileExists(thumpPath)) {
        fs.unlink(thumpPath, (err) => {
          if (err) {
            this.win.webContents.send('delete-error', err);
            return;
          }
        });
      }
      if (Helper.isFileExists(symlPath)) {
        fs.unlink(symlPath, (err) => {
          if (err) {
            this.win.webContents.send('delete-error', err);
            return;
          }
        });
      }

      if (this.win && this.win.webContents) this.win.webContents.send('file-deleted', item);
    });

    return true;
  }

  deleteCache(event, items = []) {
    const clearEverything = !Array.isArray(items) || !items.length;

    if (clearEverything) {
      if (!Helper.isFileExists(this.static_dir)) {
        event.reply('delete-cache-finish', true);
        return;
      }

      try {
        rimraf.sync(this.static_dir, { glob: false });
        event.reply('delete-cache-finish', true);
      } catch (err) {
        event.reply('delete-error', err);
      }
      return;
    }

    const smallDeleted = removeFilesHelper(
      path.join(this.static_dir, 'small'),
      items.map((item) => item.thumpName)
    );
    const bigDeleted = removeFilesHelper(
      path.join(this.static_dir, 'big'),
      items.map((item) => item.bigName)
    );

    if (!smallDeleted || !bigDeleted) {
      event.reply('delete-error', new Error('Unable to clear the selected cache files'));
      return;
    }

    event.reply('delete-cache-finish', true);
  }
}

function removeFilesHelper(dirPath, names) {
  try {
    const files = fs.readdirSync(dirPath);
    files.forEach((filename) => {
      const filePath = path.join(dirPath, filename);
      if (names.indexOf(filename) === -1) {
        fs.unlinkSync(filePath);
      }
    });
    return true;
  } catch (e) {
    console.log(e);
    return false;
  }
}

module.exports = { MainModelClass, removeFilesHelper };
Object.defineProperty(module.exports, 'default', {
  value: MainModelClass,
  enumerable: false,
});
