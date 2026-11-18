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
const renameNoReplace = require('./renameNoReplace');
const mediaCache = require('./mediaCache');
const { isSamePath } = require('./pathCompare');
const { openFileNoFollow } = require('./safeOpen');
const { extensions, isSupportedMediaPath, groupInsvFiles } = require('./mediaFormats');
const { validateInsvPair, assertCurrentPair } = require('./insvPair');
const { InsvSourceServer } = require('./insvSourceServer');
const { createInsvThumbnail } = require('./insvCache');
const { closestInsvRotation } = require('./insvMotion');
const { getCachedInsvMotion } = require('./insvMotionCache');
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
    this.importBusy = false;
    this.externalImports = [];
    this.externalImportReady = true;
    this.pendingMedia = new Map();
    this.insvSources = new InsvSourceServer();
    this.insvTokens = new Map();
  }

  init() {
    Helper.checkDir(homedir);
    this.startFileServer();
    this.updater.initialize((channel, payload) => {
      if (this.win && this.win.webContents) this.win.webContents.send(channel, payload);
    });

    ipcMain.on('open-dir', (event) => this.openDir(event));
    ipcMain.on('add-files', (event) => this.openFiles(event));
    ipcMain.on('get-server-url', (event) => event.reply('start-file-server', this.serverUrl));
    ipcMain.on('delete-selected', (event, arg) => this.deleteSelected(arg));
    ipcMain.on('remove-from-library', (event, items) => this.removeFromLibrary(items));
    ipcMain.on('get-media-metadata', async (event, payload) => {
      const origPath = payload?.origPath;
      const requestId = payload?.requestId;
      const type = payload?.type;
      const isInsv = type === 'video' && this.authorizedMedia.get(origPath) === 'insv';
      const token = isInsv ? this.insvTokens.get(origPath) : null;
      const pair = token ? this.insvSources.records.get(token) : null;
      if (
        typeof origPath !== 'string' ||
        !Number.isSafeInteger(requestId) ||
        !['image', 'video'].includes(type) ||
        (this.authorizedMedia.get(origPath) !== type && (!pair || pair.paths[0] !== origPath))
      ) {
        event.reply('media-metadata', {
          origPath: typeof origPath === 'string' ? origPath : '',
          requestId,
          error: 'This media file is not available in the current library.',
        });
        return;
      }
      try {
        let entries;
        if (isInsv) {
          await assertCurrentPair(pair);
          entries = await Media.getInsvMetadata(pair);
          await assertCurrentPair(pair);
          if (
            this.authorizedMedia.get(origPath) !== 'insv' ||
            this.insvTokens.get(origPath) !== token ||
            this.insvSources.records.get(token) !== pair
          )
            throw new Error('This INSV pair is no longer available in the current library.');
        } else {
          entries = await Media.getMetadata(origPath, type);
        }
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
        getFolderSize(path.join(this.homedir, 'insv-motion'), (motionError, motionSize) => {
          const bytes = (err ? 0 : size) + (motionError ? 0 : motionSize);
          event.reply('cache-size', (bytes / 1024 / 1024).toFixed(2));
        });
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
    if (!win) this.externalImportReady = false;
    this.directoryImportGeneration += 1;
    this.authorizedMedia.clear();
    this.exportMedia.clear();
    this.insvSources.clear();
    this.insvTokens.clear();
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
    const sourceOnly = mediaCache.getSource(bigName);
    if (sourceOnly !== undefined) {
      if (!isSamePath(sourceOnly, origPath)) throw new Error('Invalid cached media link.');
      const stat = fs.statSync(origPath);
      if (!stat.isFile() || !isSamePath(fs.realpathSync(origPath), origPath)) throw new Error('Invalid cached media.');
      const record = {
        bigName,
        cachePath,
        sourcePath: origPath,
        direct: true,
        dev: stat.dev,
        ino: stat.ino,
        size: stat.size,
        mtimeMs: stat.mtimeMs,
      };
      this.exportMedia.set(origPath, record);
      return record;
    }
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
    if (record.direct) {
      const stat = fs.statSync(record.sourcePath);
      if (
        mediaCache.getSource(record.bigName) !== record.sourcePath ||
        !stat.isFile() ||
        !isSamePath(fs.realpathSync(record.sourcePath), record.sourcePath) ||
        stat.dev !== record.dev ||
        stat.ino !== record.ino ||
        stat.size !== record.size ||
        stat.mtimeMs !== record.mtimeMs
      ) {
        throw new Error('The cached media file has changed.');
      }
      return stat;
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
      await this.copyExportMedia(origPath, record, initialStat, result.filePath, false);
      return { success: true };
    } catch (error) {
      return { success: false, message: error?.message || 'Unable to save media.' };
    } finally {
      this.mediaSaveInProgress = false;
    }
  }

  async saveSelectedMedia(origPaths, onProgress = () => {}) {
    if (this.mediaSaveInProgress) return { success: false, message: 'A media export is already in progress.' };
    this.mediaSaveInProgress = true;
    try {
      if (
        !Array.isArray(origPaths) ||
        !origPaths.length ||
        origPaths.some((origPath) => typeof origPath !== 'string' || !origPath) ||
        new Set(origPaths).size !== origPaths.length ||
        origPaths.some((origPath) => !this.authorizedMedia.has(origPath) || !this.exportMedia.has(origPath))
      ) {
        throw new Error('The selected media files are invalid or no longer available in the current library.');
      }

      const entries = origPaths.map((origPath) => {
        const record = this.exportMedia.get(origPath);
        try {
          return { origPath, record, initialStat: this.validateExportMedia(origPath, record) };
        } catch (error) {
          return { origPath, record, error };
        }
      });
      const result = await dialog.showOpenDialog(this.win, {
        title: 'Save selected media',
        properties: ['openDirectory'],
      });
      if (result.canceled || !result.filePaths?.length) return { cancelled: true };

      let saved = 0;
      const errors = [];
      onProgress({ complete: 0, total: entries.length });
      for (const entry of entries) {
        try {
          if (entry.error) throw entry.error;
          const name = `${path.parse(entry.origPath).name}${path.extname(entry.record.bigName)}`;
          await this.copyExportMedia(
            entry.origPath,
            entry.record,
            entry.initialStat,
            path.join(result.filePaths[0], name),
            true
          );
          saved += 1;
        } catch (error) {
          errors.push({ origPath: entry.origPath, message: error?.message || 'Unable to save media.' });
        }
        onProgress({ complete: saved + errors.length, total: entries.length });
      }
      return { success: errors.length === 0, saved, errors };
    } catch (error) {
      return { success: false, message: error?.message || 'Unable to save selected media.' };
    } finally {
      this.mediaSaveInProgress = false;
    }
  }

  async copyExportMedia(origPath, record, initialStat, filePath, unique) {
    let source;
    let destination;
    let tempPath;
    try {
      this.validateExportMedia(origPath, record);
      source = await openFileNoFollow(record.sourcePath);
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
      const destStat = unique ? null : await getExportDestinationStat(filePath);
      if (destStat && !destStat.isFile()) throw new Error('The destination must be a regular file.');
      if (
        (destStat && destStat.dev === sourceStat.dev && destStat.ino === sourceStat.ino) ||
        isSamePath(filePath, record.sourcePath)
      ) {
        throw new Error('Cannot save media over its source.');
      }
      const candidate = path.join(path.dirname(filePath), `.sht-vr-export-${crypto.randomUUID()}.tmp`);
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
      if (unique) {
        const parsed = path.parse(filePath);
        let useRename = false;
        for (let suffix = 0; ; suffix += 1) {
          const current = this.validateExportMedia(origPath, record);
          if (
            current.size !== initialStat.size ||
            current.mtimeMs !== initialStat.mtimeMs ||
            current.ctimeMs !== initialStat.ctimeMs
          ) {
            throw new Error('The cached media file has changed.');
          }
          const target = suffix ? path.join(parsed.dir, `${parsed.name} (${suffix})${parsed.ext}`) : filePath;
          try {
            if (useRename) {
              await renameNoReplace(tempPath, target);
              tempPath = undefined;
            } else {
              try {
                await fs.promises.link(tempPath, target);
              } catch (error) {
                if (!['EPERM', 'ENOTSUP', 'EOPNOTSUPP', 'ENOSYS'].includes(error.code)) throw error;
                useRename = true;
                await renameNoReplace(tempPath, target);
                tempPath = undefined;
              }
            }
            break;
          } catch (error) {
            if (error.code !== 'EEXIST') throw error;
          }
        }
      } else {
        const currentDest = await getExportDestinationStat(filePath);
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
        await fs.promises.rename(tempPath, filePath);
        tempPath = undefined;
      }
    } finally {
      const closed = await Promise.allSettled([source?.close(), destination?.close()]);
      if (tempPath) {
        try {
          await fs.promises.unlink(tempPath);
        } catch (error) {
          console.error('Unable to remove temporary media export:', error);
        }
      }
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

  // Streams the validated open handle (not the path) so a swapped path cannot redirect the read.
  async serveDirectSource(req, res, origPath, record) {
    let handle;
    try {
      const initial = this.validateExportMedia(origPath, record);
      handle = await openFileNoFollow(record.sourcePath);
      const stat = await handle.stat();
      if (!stat.isFile() || stat.dev !== record.dev || stat.ino !== record.ino || stat.size !== initial.size) {
        throw new Error('The cached media file has changed.');
      }
      let start = 0;
      let end = stat.size - 1;
      const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Cache-Control', 'no-store');
      res.type(path.extname(record.sourcePath) || 'bin');
      if (range && (range[1] || range[2])) {
        if (range[1]) {
          start = Number(range[1]);
          if (range[2]) end = Math.min(Number(range[2]), end);
        } else {
          start = Math.max(stat.size - Number(range[2]), 0);
        }
        if (start > end || start >= stat.size) {
          res.setHeader('Content-Range', `bytes */${stat.size}`);
          res.sendStatus(416);
          await handle.close();
          return;
        }
        res.status(206);
        res.setHeader('Content-Range', `bytes ${start}-${end}/${stat.size}`);
      }
      res.setHeader('Content-Length', stat.size ? end - start + 1 : 0);
      if (!stat.size) {
        res.end();
        await handle.close();
        return;
      }
      const stream = handle.createReadStream({ start, end, autoClose: true });
      stream.on('error', () => res.destroy());
      res.on('close', () => stream.destroy());
      stream.pipe(res);
    } catch (error) {
      if (handle) await handle.close().catch(() => {});
      if (!res.headersSent) res.sendStatus(404);
      else res.destroy();
    }
  }

  startFileServer() {
    const app = express();
    app.use(cors());
    app.get('/insv/:token/orientation', (req, res) => void this.insvSources.serveHorizon(req, res));
    app.get('/insv/:token/:lens', (req, res) => void this.insvSources.serve(req, res));
    app.get('/big/:name', (req, res, next) => {
      const origPath = mediaCache.getSource(req.params.name);
      if (origPath === undefined) {
        next();
        return;
      }
      const record = this.exportMedia.get(origPath);
      try {
        if (!record || !record.direct || record.bigName !== req.params.name) throw new Error('Not authorized.');
        this.validateExportMedia(origPath, record);
      } catch (error) {
        res.sendStatus(404);
        return;
      }
      this.serveDirectSource(req, res, origPath, record);
    });
    app.use(express.static(homedir + '/static'));
    const server = app.listen(0);

    this.serverUrl = `http://localhost:${server.address().port}/`;
    console.log(`Static file server run on: ${this.serverUrl}`);
    if (this.win && this.win.webContents) {
      this.win.webContents.send('start-file-server', this.serverUrl);
    }
  }

  openDir(event) {
    if (this.importBusy) {
      event.reply('open-dir', false);
      return false;
    }
    this.importBusy = true;
    const options = { properties: ['openDirectory'] };
    let resOpen;
    try {
      resOpen = dialog.showOpenDialogSync(options);
    } catch (error) {
      event.reply('show-error', { message: error.message });
      event.reply('open-dir', false);
      this.finishImport();
      return false;
    }

    if (!resOpen) {
      event.reply('open-dir', false);
      this.finishImport();
      return false;
    }

    event.reply('open-dir', resOpen[0]);
    Promise.resolve(this.readDir(resOpen[0])).finally(() => this.finishImport());
    return resOpen;
  }

  openFiles(event) {
    if (this.importBusy) {
      event.reply('add-files', false);
      return false;
    }
    this.importBusy = true;
    let files;
    try {
      files = dialog.showOpenDialogSync({
        properties: ['openFile', 'multiSelections'],
        filters: [{ name: 'Media', extensions }],
      });
    } catch (error) {
      event.reply('show-error', { message: error.message });
    }
    if (!files || !files.length) {
      event.reply('add-files', false);
      this.finishImport();
      return false;
    }
    Promise.resolve(this.readFiles(files))
      .catch((error) => {
        event.reply('show-error', { message: error.message || 'Unable to import media.' });
        event.reply('import-finished');
      })
      .finally(() => this.finishImport());
    return files;
  }

  enqueueExternalImport(request) {
    this.externalImports.push(request);
    this.drainExternalImports();
  }

  setExternalImportReady(ready) {
    this.externalImportReady = ready;
    if (ready) this.drainExternalImports();
  }

  finishImport() {
    this.importBusy = false;
    this.drainExternalImports();
  }

  async drainExternalImports() {
    if (!this.externalImportReady || this.importBusy || !this.win?.webContents || !this.externalImports.length) return;
    this.importBusy = true;
    const { directory, files } = this.externalImports.shift();
    try {
      if (directory) {
        this.win?.webContents?.send('open-dir', directory);
        await this.readDir(directory);
      }
      if (files?.length) await this.readFiles(files);
    } catch (error) {
      this.win?.webContents?.send('show-error', { message: error.message || 'Unable to import media.' });
      this.win?.webContents?.send('import-finished');
    } finally {
      this.finishImport();
    }
  }

  readDir(pathDir) {
    const importGeneration = ++this.directoryImportGeneration;
    this.authorizedMedia = new Map();
    this.exportMedia = new Map();
    this.insvSources.clear();
    this.insvTokens.clear();
    this.pendingMedia.clear();
    return new Promise((resolve) =>
      fs.readdir(pathDir, async (err, files) => {
        if (importGeneration !== this.directoryImportGeneration) {
          resolve();
          return;
        }

        if (err) {
          if (this.win && this.win.webContents) {
            this.win.webContents.send('show-error', err);
            this.win.webContents.send('open-dir', false);
          }
          resolve();
          return;
        }

        try {
          await this.prepareMedia(
            files.filter(isSupportedMediaPath).map((file) => path.join(pathDir, file)),
            false,
            importGeneration
          );
        } catch (error) {
          this.win?.webContents?.send('show-error', { message: error.message || 'Unable to import media.' });
          this.win?.webContents?.send('open-dir', false);
        }
        resolve();
      })
    );
  }

  readFiles(files) {
    if (!Array.isArray(files)) {
      this.win?.webContents?.send('show-error', { message: 'Invalid media file list.' });
      this.win?.webContents?.send('import-finished');
      return Promise.resolve();
    }
    return this.prepareMedia(files, true, this.directoryImportGeneration);
  }

  async prepareMedia(files, append, importGeneration) {
    Helper.checkDir(this.static_dir + '/small/');
    Helper.checkDir(this.static_dir + '/big/');
    const seen = new Set();
    const work = [];
    for (const { filePath, error: groupingError, insvPair } of groupInsvFiles(files)) {
      try {
        if (groupingError) throw new Error(groupingError);
        if (insvPair) {
          work.push({ filePath, insvPair });
          continue;
        }
        if (!isSupportedMediaPath(filePath)) throw new Error('Unsupported media file.');
        const origPath = fs.realpathSync(filePath);
        if (!fs.statSync(origPath).isFile()) throw new Error('The selected path is not a regular file.');
        if (seen.has(origPath) || (append && this.authorizedMedia.has(origPath))) continue;
        seen.add(origPath);
        work.push({ filePath, origPath });
      } catch (error) {
        work.push({ filePath, error: error.code ? 'Unable to access this media file.' : error.message });
      }
    }
    this.win?.webContents?.send(append ? 'start-read-files' : 'start-read-dir', work.length);
    if (!work.length && !append) this.win?.webContents?.send('open-dir', false);
    const exifSyncs = new Map();
    let insvQueue = Promise.resolve();
    await Promise.all(
      work.map(({ filePath, origPath, error, insvPair }) => {
        if (insvPair) {
          insvQueue = insvQueue.then(async () => {
            let result;
            try {
              if (importGeneration !== this.directoryImportGeneration) return;
              this.win?.webContents?.send('insv-progress', {
                name: path.basename(filePath),
                active: true,
                stage: 'checking',
              });
              const pair = await validateInsvPair(insvPair, Media.probeVideo, Media.verifyInsvVideo);
              if (importGeneration !== this.directoryImportGeneration) return;
              if (this.authorizedMedia.has(pair.paths[0])) throw new Error('This INSV pair is already in the library.');
              const motion = await getCachedInsvMotion(pair, path.join(this.homedir, 'insv-motion'), {
                isCurrent: () => importGeneration === this.directoryImportGeneration,
                onCacheMiss: () => {
                  this.win?.webContents?.send('insv-progress', {
                    name: path.basename(filePath),
                    active: true,
                    stage: 'stabilizing',
                  });
                },
              });
              if (importGeneration !== this.directoryImportGeneration) return;
              const rotation = closestInsvRotation(motion.frames, pair.sampleTime);
              const thumpName = await createInsvThumbnail(pair, path.join(this.static_dir, 'small'), rotation);
              await assertCurrentPair(pair);
              if (importGeneration !== this.directoryImportGeneration) return;
              const insvToken = this.insvSources.register(pair, motion.frames);
              this.insvTokens.set(pair.paths[0], insvToken);
              this.authorizedMedia.set(pair.paths[0], 'insv');
              result = {
                type: 'video',
                insv: true,
                origPath: pair.paths[0],
                thumpName,
                bigName: thumpName,
                insvToken,
                frameRate: pair.video.fps,
                motionMode: motion.mode,
                motionWarning: motion.warning,
              };
            } catch (validationError) {
              result = {
                error: {
                  message: validationError.code
                    ? 'Unable to access or inspect the INSV pair. Make sure both files and ffprobe are available.'
                    : validationError.message,
                },
                origPath: filePath,
              };
            } finally {
              if (importGeneration === this.directoryImportGeneration) {
                this.win?.webContents?.send('insv-progress', { active: false });
              }
            }
            if (importGeneration === this.directoryImportGeneration) {
              this.win?.webContents?.send('read-media-file', result);
            }
          });
          return insvQueue;
        }
        return new Promise((resolve) => {
          if (error) {
            this.win?.webContents?.send('read-media-file', { error: { message: error }, origPath: filePath });
            resolve();
            return;
          }
          const ext = path.extname(filePath).slice(1).toLowerCase();
          const type = ext === 'mp4' ? 'video' : 'image';
          const token = {};
          this.pendingMedia.set(origPath, token);
          this.authorizedMedia.set(origPath, type);
          let completed = false;
          const sendMediaResult = async (result) => {
            if (completed) return;
            completed = true;
            const isCurrent = () =>
              importGeneration === this.directoryImportGeneration &&
              this.pendingMedia.get(origPath) === token &&
              this.authorizedMedia.get(origPath) === type;
            if (!isCurrent()) {
              if (importGeneration === this.directoryImportGeneration) {
                this.win?.webContents?.send('read-media-file', {
                  error: { message: 'Media is no longer available.' },
                  origPath,
                });
              }
              resolve();
              return;
            }
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
                  if (!isCurrent()) {
                    if (importGeneration === this.directoryImportGeneration) {
                      this.win?.webContents?.send('read-media-file', {
                        error: { message: 'Media is no longer available.' },
                        origPath,
                      });
                    }
                    resolve();
                    return;
                  }
                  this.recordExportMedia(origPath, result.bigName);
                }
              } catch (error) {
                if (!isCurrent()) {
                  if (importGeneration === this.directoryImportGeneration) {
                    this.win?.webContents?.send('read-media-file', {
                      error: { message: 'Media is no longer available.' },
                      origPath,
                    });
                  }
                  resolve();
                  return;
                }
                result = {
                  ...result,
                  error: { message: error?.message || 'Unable to validate the cached media file.' },
                };
                this.authorizedMedia.delete(origPath);
                this.exportMedia.delete(origPath);
              }
            }
            if (importGeneration === this.directoryImportGeneration && this.win && this.win.webContents) {
              this.win.webContents.send('read-media-file', result);
            }
            if (this.pendingMedia.get(origPath) === token) this.pendingMedia.delete(origPath);
            resolve();
          };

          try {
            let operation;
            if (type === 'video') {
              operation = Media.saveVideo(origPath, this.win, sendMediaResult);
            } else if (ext === 'insp') {
              operation = Media.saveInsta360Image(origPath, this.win, sendMediaResult);
            } else {
              operation = Media.saveImage(origPath, this.win, sendMediaResult);
            }
            if (operation && typeof operation.catch === 'function') {
              operation.catch((err) => sendMediaResult({ origPath, error: { message: err.message } }));
            }
          } catch (err) {
            sendMediaResult({ origPath, error: { message: err.message } });
          }
        });
      })
    );
    if (importGeneration === this.directoryImportGeneration) this.win?.webContents?.send('import-finished');
  }

  deleteSelected(dataArray = []) {
    dataArray.forEach(async (item) => {
      if (this.authorizedMedia.get(item.origPath) === 'insv') {
        this.win?.webContents?.send('delete-error', { message: 'Deleting INSV pairs is not available.' });
        return;
      }
      this.authorizedMedia.delete(item.origPath);
      this.exportMedia.delete(item.origPath);
      mediaCache.unregisterSource(item.bigName);
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

  removeFromLibrary(items) {
    if (!Array.isArray(items)) return;
    for (const item of items) {
      if (typeof item?.origPath !== 'string') continue;
      const token = this.insvTokens.get(item.origPath);
      if (token) this.insvSources.revoke(token);
      this.insvTokens.delete(item.origPath);
      this.authorizedMedia.delete(item.origPath);
      this.exportMedia.delete(item.origPath);
    }
  }

  deleteCache(event, items = []) {
    this.directoryImportGeneration += 1;
    this.authorizedMedia.clear();
    this.exportMedia.clear();
    this.insvSources.clear();
    this.insvTokens.clear();
    mediaCache.clearSources();
    const clearEverything = !Array.isArray(items) || !items.length;
    const motionDir = path.join(this.homedir, 'insv-motion');

    if (clearEverything) {
      try {
        rimraf.sync(this.static_dir, { glob: false });
        rimraf.sync(motionDir, { glob: false });
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
