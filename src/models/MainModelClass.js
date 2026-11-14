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
    this.authorizedMedia = new Map();
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
      const requestId = payload?.requestId;
      const type = payload?.type;
      if (
        typeof origPath !== 'string' ||
        !Number.isSafeInteger(requestId) ||
        !['image', 'video'].includes(type) ||
        this.authorizedMedia.get(origPath) !== type
      ) {
        event.reply('media-metadata', {
          origPath: typeof origPath === 'string' ? origPath : '',
          requestId,
          error: 'This media file is not available in the current library.',
        });
        return;
      }
      try {
        const entries = await Media.getMetadata(origPath, type);
        event.reply('media-metadata', { origPath, requestId, entries });
      } catch (error) {
        event.reply('media-metadata', {
          origPath,
          requestId,
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

  async savePanoramaScreenshot(payload) {
    const data = payload?.data;
    let bytes;
    if (data instanceof ArrayBuffer) {
      bytes = Buffer.from(data);
    } else if (ArrayBuffer.isView(data)) {
      bytes = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
    }

    const maxScreenshotBytes = 50 * 1024 * 1024;
    if (!bytes || bytes.length > maxScreenshotBytes || !isStructurallyValidJpeg(bytes)) {
      return { success: false, message: 'Screenshot data is invalid.' };
    }

    const now = new Date();
    const timestamp =
      [now.getFullYear(), String(now.getMonth() + 1).padStart(2, '0'), String(now.getDate()).padStart(2, '0')].join(
        '-'
      ) +
      `-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`;

    try {
      const result = await dialog.showSaveDialog(this.win, {
        title: 'Save 360° screenshot',
        defaultPath: `360-screenshot-${timestamp}.jpg`,
        filters: [{ name: 'JPEG image', extensions: ['jpg', 'jpeg'] }],
      });
      if (result.canceled || !result.filePath) return { cancelled: true };

      await fs.promises.writeFile(result.filePath, bytes);
      return { success: true };
    } catch (error) {
      return { success: false, message: 'Unable to save the 360° screenshot.' };
    }
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
    this.authorizedMedia = new Map();
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
        const filePath = path.join(pathDir, file);
        let origPath;
        try {
          origPath = fs.realpathSync(filePath);
        } catch (error) {
          if (this.win && this.win.webContents) {
            this.win.webContents.send('read-media-file', {
              error: { message: 'Unable to access this media file.' },
              origPath: filePath,
            });
          }
          return;
        }
        const type = ext === 'mp4' ? 'video' : 'image';
        this.authorizedMedia.set(origPath, type);

        if (type === 'video') {
          Media.saveVideo(origPath, this.win);
        } else {
          Media.saveImage(origPath, this.win);
        }
      });
    });
  }

  deleteSelected(dataArray = []) {
    dataArray.forEach(async (item) => {
      this.authorizedMedia.delete(item.origPath);
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

function isStructurallyValidJpeg(bytes) {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return false;

  let offset = 2;
  let hasFrame = false;
  let hasScan = false;
  let inScanData = false;

  while (offset < bytes.length) {
    if (inScanData) {
      if (bytes[offset] !== 0xff) {
        offset += 1;
        continue;
      }

      const markerStart = offset;
      while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
      if (offset >= bytes.length) return false;

      const marker = bytes[offset];
      if (marker === 0x00 || (marker >= 0xd0 && marker <= 0xd7)) {
        offset += 1;
        continue;
      }
      if (marker === 0xd9) {
        return hasFrame && hasScan && offset + 1 === bytes.length;
      }

      inScanData = false;
      offset = markerStart;
    }

    if (bytes[offset] !== 0xff) return false;
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
    if (offset >= bytes.length) return false;

    const marker = bytes[offset];
    offset += 1;
    if (marker === 0xd9 || marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      return false;
    }
    if (offset + 2 > bytes.length) return false;

    const segmentLength = bytes.readUInt16BE(offset);
    if (segmentLength < 2 || offset + segmentLength > bytes.length) return false;

    if (isStartOfFrameMarker(marker)) {
      const componentCount = bytes[offset + 7];
      if (segmentLength !== 8 + componentCount * 3) return false;
      hasFrame = true;
    } else if (marker === 0xda) {
      const componentCount = bytes[offset + 2];
      if (!hasFrame || segmentLength !== 6 + componentCount * 2) return false;
      hasScan = true;
      inScanData = true;
    }

    offset += segmentLength;
  }

  return false;
}

function isStartOfFrameMarker(marker) {
  return [0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker);
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
