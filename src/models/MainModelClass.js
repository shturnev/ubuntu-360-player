const fs = require('fs');
const express = require('express');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');
const { pipeline } = require('stream/promises');
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

async function getExportDestinationStat(filePath) {
  try {
    return await fs.promises.lstat(filePath);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

class MainModelClass {
  constructor(win, updater = new Updater()) {
    this.win = win;
    this.serverUrl = undefined;
    this.homedir = homedir;
    this.static_dir = homedir + '/static';
    this.config = new ConfigModel();
    this.updater = updater;
    this.authorizedMedia = new Map();
    this.exportMedia = new Map();
    this.directoryImportGeneration = 0;
    this.mediaSaveInProgress = false;
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
      if (typeof inputPath !== 'string' || this.authorizedMedia.get(inputPath) !== 'video') {
        event.reply('video-conversion-result', {
          success: false,
          message: 'No video file was provided for conversion.',
        });
        return;
      }

      try {
        const generation = this.directoryImportGeneration;
        const previous = this.exportMedia.get(inputPath);
        if (!previous) throw new Error('This media file is not ready for conversion.');
        const result = await Media.convertVideoFor360(inputPath, this.win);
        if (
          generation !== this.directoryImportGeneration ||
          this.exportMedia.get(inputPath) !== previous ||
          this.authorizedMedia.get(inputPath) !== 'video'
        ) {
          throw new Error('This media file is no longer available in the current library.');
        }
        this.recordExportMedia(inputPath, result.bigName);
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

  setWindow(win) {
    this.win = win;
    this.directoryImportGeneration += 1;
    this.authorizedMedia.clear();
    this.exportMedia.clear();
    if (win?.webContents && this.serverUrl) win.webContents.send('start-file-server', this.serverUrl);
  }

  recordExportMedia(origPath, bigName) {
    if (
      typeof bigName !== 'string' ||
      !bigName ||
      path.basename(bigName) !== bigName ||
      bigName === '.' ||
      bigName === '..'
    ) {
      throw new Error('Invalid cached media name.');
    }
    const bigDir = fs.realpathSync(path.join(this.static_dir, 'big'));
    const cachePath = path.join(bigDir, bigName);
    const linkStat = fs.lstatSync(cachePath);
    if (!linkStat.isFile() && !linkStat.isSymbolicLink()) throw new Error('Invalid cached media.');
    const sourcePath = fs.realpathSync(cachePath);
    if (linkStat.isSymbolicLink() && sourcePath !== origPath) throw new Error('Invalid cached media link.');
    if (!linkStat.isSymbolicLink() && sourcePath !== cachePath) throw new Error('Invalid cached media path.');
    const stat = fs.statSync(sourcePath);
    if (!stat.isFile()) throw new Error('Invalid cached media file.');
    const record = {
      bigName,
      cachePath,
      sourcePath,
      linkDev: linkStat.dev,
      linkIno: linkStat.ino,
      dev: stat.dev,
      ino: stat.ino,
    };
    this.exportMedia.set(origPath, record);
    return record;
  }

  validateExportMedia(origPath, record) {
    if (!record || !this.authorizedMedia.has(origPath) || this.exportMedia.get(origPath) !== record) {
      throw new Error('This media file is no longer available in the current library.');
    }
    const link = fs.lstatSync(record.cachePath);
    const sourcePath = fs.realpathSync(record.cachePath);
    const stat = fs.statSync(sourcePath);
    if (
      (!link.isFile() && !link.isSymbolicLink()) ||
      !stat.isFile() ||
      link.dev !== record.linkDev ||
      link.ino !== record.linkIno ||
      sourcePath !== record.sourcePath ||
      stat.dev !== record.dev ||
      stat.ino !== record.ino ||
      (link.isSymbolicLink() && sourcePath !== origPath)
    ) {
      throw new Error('The cached media file has changed.');
    }
    return stat;
  }

  async saveCurrentMedia(payload) {
    const origPath = payload?.origPath;
    if (this.mediaSaveInProgress) return { success: false, message: 'A media export is already in progress.' };
    this.mediaSaveInProgress = true;
    let source;
    let destination;
    let tempPath;
    try {
      const record = typeof origPath === 'string' && this.exportMedia.get(origPath);
      const initialStat = this.validateExportMedia(origPath, record);
      const extension = path.extname(record.bigName);
      const defaultPath = `${path.parse(origPath).name}${extension}`;
      const result = await dialog.showSaveDialog(this.win, {
        title: 'Save media',
        defaultPath,
        filters: extension ? [{ name: 'Media', extensions: [extension.slice(1)] }] : undefined,
      });
      if (result.canceled || !result.filePath) return { cancelled: true };
      if (extension && path.extname(result.filePath).toLowerCase() !== extension.toLowerCase()) {
        throw new Error(`The destination must use the ${extension} extension.`);
      }
      this.validateExportMedia(origPath, record);
      source = await fs.promises.open(record.sourcePath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
      const sourceStat = await source.stat();
      if (
        !sourceStat.isFile() ||
        sourceStat.dev !== record.dev ||
        sourceStat.ino !== record.ino ||
        sourceStat.size !== initialStat.size ||
        sourceStat.mtimeMs !== initialStat.mtimeMs ||
        sourceStat.ctimeMs !== initialStat.ctimeMs
      ) {
        throw new Error('The cached media file has changed.');
      }
      this.validateExportMedia(origPath, record);
      const destStat = await getExportDestinationStat(result.filePath);
      if (destStat && !destStat.isFile()) throw new Error('The destination must be a regular file.');
      if (destStat && destStat.dev === sourceStat.dev && destStat.ino === sourceStat.ino) {
        throw new Error('Cannot save media over its source.');
      }
      const candidate = path.join(path.dirname(result.filePath), `.sht-vr-export-${crypto.randomUUID()}.tmp`);
      destination = await fs.promises.open(
        candidate,
        fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL,
        0o666
      );
      tempPath = candidate;
      if (destStat) await destination.chmod(destStat.mode & 0o777);
      await pipeline(source.createReadStream(), destination.createWriteStream());
      const currentSource = this.validateExportMedia(origPath, record);
      if (
        currentSource.size !== initialStat.size ||
        currentSource.mtimeMs !== initialStat.mtimeMs ||
        currentSource.ctimeMs !== initialStat.ctimeMs
      ) {
        throw new Error('The cached media file has changed.');
      }
      const currentDest = await getExportDestinationStat(result.filePath);
      if (
        Boolean(destStat) !== Boolean(currentDest) ||
        (destStat &&
          (destStat.dev !== currentDest.dev ||
            destStat.ino !== currentDest.ino ||
            destStat.size !== currentDest.size ||
            destStat.mtimeMs !== currentDest.mtimeMs ||
            destStat.ctimeMs !== currentDest.ctimeMs))
      ) {
        throw new Error('The destination file has changed.');
      }
      this.validateExportMedia(origPath, record);
      await fs.promises.rename(tempPath, result.filePath);
      tempPath = undefined;
      return { success: true };
    } catch (error) {
      return { success: false, message: error?.message || 'Unable to save media.' };
    } finally {
      const closed = await Promise.allSettled([source?.close(), destination?.close()]);
      if (tempPath) {
        try {
          await fs.promises.unlink(tempPath);
        } catch (error) {
          console.error('Unable to remove temporary media export:', error);
        }
      }
      this.mediaSaveInProgress = false;
      closed.filter((result) => result.status === 'rejected').forEach((result) => console.error(result.reason));
    }
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

  async saveOrientationCorrection(payload) {
    const origPath = payload?.origPath;
    const orientation = payload?.orientation;
    const isValidOrientation =
      orientation &&
      Number.isFinite(orientation.yaw) &&
      Number.isFinite(orientation.pitch) &&
      Number.isFinite(orientation.roll) &&
      orientation.yaw >= -180 &&
      orientation.yaw <= 180 &&
      orientation.pitch >= -90 &&
      orientation.pitch <= 90 &&
      orientation.roll >= -180 &&
      orientation.roll <= 180;

    if (typeof origPath !== 'string' || this.authorizedMedia.get(origPath) !== 'image' || !isValidOrientation) {
      return { success: false, message: 'This image or orientation correction is invalid.' };
    }

    try {
      const generation = this.directoryImportGeneration;
      const previous = this.exportMedia.get(origPath);
      const result = await Media.saveOrientationCorrection(origPath, orientation);
      if (
        generation !== this.directoryImportGeneration ||
        this.exportMedia.get(origPath) !== previous ||
        this.authorizedMedia.get(origPath) !== 'image'
      ) {
        throw new Error('This media file is no longer available in the current library.');
      }
      if (previous) {
        this.recordExportMedia(origPath, result.bigName);
      }
      return { success: true, ...result };
    } catch (error) {
      return { success: false, message: error?.message || 'Unable to save orientation correction.' };
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
    const importGeneration = ++this.directoryImportGeneration;
    this.authorizedMedia = new Map();
    this.exportMedia = new Map();
    fs.readdir(pathDir, (err, files) => {
      if (importGeneration !== this.directoryImportGeneration) {
        return;
      }

      if (err) {
        if (this.win && this.win.webContents) {
          this.win.webContents.send('show-error', err);
          this.win.webContents.send('open-dir', false);
        }
        return;
      }

      Helper.checkDir(this.static_dir + '/small/');
      Helper.checkDir(this.static_dir + '/big/');

      const goodExt = ['jpg', 'jpeg', 'png', 'insp', 'mp4'];
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

      const exifSyncs = new Map();
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
        const sendMediaResult = async (result) => {
          const isCurrent = () =>
            importGeneration === this.directoryImportGeneration && this.authorizedMedia.get(origPath) === type;
          if (!isCurrent()) return;
          if (result && result.error) {
            this.authorizedMedia.delete(origPath);
            this.exportMedia.delete(origPath);
          } else if (result && result.bigName) {
            try {
              const record = this.recordExportMedia(origPath, result.bigName);
              if (type === 'image' && !fs.lstatSync(record.cachePath).isSymbolicLink()) {
                let sync = exifSyncs.get(record.cachePath);
                if (!sync) {
                  sync = Media.syncCachedExif(origPath, record.cachePath, isCurrent);
                  exifSyncs.set(record.cachePath, sync);
                }
                await sync;
                if (!isCurrent()) return;
                this.recordExportMedia(origPath, result.bigName);
              }
            } catch (error) {
              if (!isCurrent()) return;
              result = { ...result, error: { message: error?.message || 'Unable to validate the cached media file.' } };
              this.authorizedMedia.delete(origPath);
              this.exportMedia.delete(origPath);
            }
          }
          if (importGeneration === this.directoryImportGeneration && this.win && this.win.webContents) {
            this.win.webContents.send('read-media-file', result);
          }
        };

        if (type === 'video') {
          Media.saveVideo(origPath, this.win, sendMediaResult);
        } else if (ext === 'insp') {
          Media.saveInsta360Image(origPath, this.win, sendMediaResult);
        } else {
          Media.saveImage(origPath, this.win, sendMediaResult);
        }
      });
    });
  }

  deleteSelected(dataArray = []) {
    dataArray.forEach(async (item) => {
      this.authorizedMedia.delete(item.origPath);
      this.exportMedia.delete(item.origPath);
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
    this.directoryImportGeneration += 1;
    this.authorizedMedia.clear();
    this.exportMedia.clear();
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
