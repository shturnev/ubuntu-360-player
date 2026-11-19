const fs = require('fs');
const express = require('express');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');
const { pipeline } = require('stream/promises');
const { dialog, ipcMain, shell } = require('electron');

const { getStorageRoot } = require('../config/env');
const { Helper } = require('./Helper');
const { Media } = require('./Media');
const renameNoReplace = require('./renameNoReplace');
const mediaCache = require('./mediaCache');
const { isSamePath } = require('./pathCompare');
const { openFileNoFollow } = require('./safeOpen');
const { exportFileName } = require('./exportName');
const { renameWithRetry } = require('./fsRetry');
const { extensions, isSupportedMediaPath, groupInsvFiles } = require('./mediaFormats');
const { validateInsvPair, assertCurrentPair } = require('./insvPair');
const { InsvSourceServer } = require('./insvSourceServer');
const { createInsvThumbnail } = require('./insvCache');
const { closestInsvRotation } = require('./insvMotion');
const { getCachedInsvMotion } = require('./insvMotionCache');
const { isValidLensFov } = require('./lensFov');
const { LensOverrides, insvIdentity } = require('./lensOverrides');
const { InspCorrections, inspIdentity, isValidRotation } = require('./inspCorrections');
const { snapshotInsp, assertCurrentInsp } = require('./inspSource');
const ConfigModel = require('./ConfigModel');
const Updater = require('./Updater');

const homedir = getStorageRoot();
const clr = require('cli-color');
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
    this.insvQueue = Promise.resolve();
    this.insvLensRequests = new Map();
    this.insvLensBusy = false;
    this.inspMedia = new Map();
    this.inspRequests = new Map();
    this.inspBusy = false;
    this.inspPromptQueue = Promise.resolve();
    this.importController = new AbortController();
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
        (this.authorizedMedia.get(origPath) !== type && (!pair || !isSamePath(pair.paths[0], origPath)))
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
    ipcMain.on('delete-cache', (event, items) => void this.requestDeleteCache(event, items));
    ipcMain.on('get-config', (event) => {
      try {
        event.reply('config-data', this.config.getSettings());
      } catch (error) {
        event.reply('show-error', { message: error.message || 'Unable to read settings.' });
      }
    });
    ipcMain.on('save-config', (event, data) => {
      try {
        if (typeof data?.checkUpdates !== 'boolean') throw new Error('Invalid update settings.');
        this.config.loadSettings({ ...this.config.getSettings(), checkUpdates: data.checkUpdates });
      } catch (error) {
        event.reply('show-error', { message: error.message || 'Unable to save settings.' });
      }
    });

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
    this.cancelPendingMedia();
    this.authorizedMedia.clear();
    this.exportMedia.clear();
    this.insvSources.clear();
    this.insvTokens.clear();
    this.inspMedia.clear();
    if (win?.webContents && this.serverUrl) win.webContents.send('start-file-server', this.serverUrl);
  }

  cancelPendingMedia() {
    this.importController.abort();
    this.importController = new AbortController();
    for (const token of this.pendingMedia.values()) token.controller?.abort();
    this.pendingMedia.clear();
    for (const request of this.insvLensRequests.values()) request.controller.abort();
    this.insvLensRequests.clear();
    for (const request of this.inspRequests.values()) request.controller.abort();
    this.inspRequests.clear();
  }

  enqueueInsvJob(job) {
    const operation = this.insvQueue.then(job);
    this.insvQueue = operation.then(
      () => undefined,
      () => undefined
    );
    return operation;
  }

  cancelInsvLensCorrection(payload) {
    const request = this.insvLensRequests.get(payload?.origPath);
    if (request && request.id === payload?.requestId) {
      request.controller.abort();
      this.insvLensRequests.delete(payload.origPath);
    }
  }

  async saveInsvLensCorrection(payload) {
    const { origPath, requestId, value } = payload || {};
    if (
      typeof origPath !== 'string' ||
      !Number.isSafeInteger(requestId) ||
      requestId <= 0 ||
      (value !== null && !isValidLensFov(value)) ||
      this.authorizedMedia.get(origPath) !== 'insv'
    ) {
      return { success: false, message: 'This INSV pair or lens correction is invalid.' };
    }
    if (this.insvLensBusy) return { success: false, message: 'Another INSV lens correction is still processing.' };
    const token = this.insvTokens.get(origPath);
    const pair = this.insvSources.records.get(token);
    const frames = this.insvSources.horizonTracks.get(token);
    if (!pair || !frames || pair.paths[0] !== origPath) {
      return { success: false, message: 'This INSV pair is no longer available.' };
    }
    const generation = this.directoryImportGeneration;
    const request = { id: requestId, controller: new AbortController() };
    this.insvLensRequests.set(origPath, request);
    this.insvLensBusy = true;
    const isCurrent = () =>
      this.insvLensRequests.get(origPath) === request &&
      this.directoryImportGeneration === generation &&
      this.authorizedMedia.get(origPath) === 'insv' &&
      this.insvTokens.get(origPath) === token &&
      this.insvSources.records.get(token) === pair;
    try {
      const fieldOfView = value === null ? this.config.getSettings().insvLensFov : value;
      return await this.enqueueInsvJob(async () => {
        if (!isCurrent()) throw new Error('The INSV lens correction was cancelled.');
        await assertCurrentPair(pair);
        const rotation = closestInsvRotation(frames, pair.sampleTime);
        const thumpName = await createInsvThumbnail(pair, path.join(this.static_dir, 'small'), rotation, fieldOfView, {
          signal: request.controller.signal,
        });
        await assertCurrentPair(pair);
        if (!isCurrent()) throw new Error('The INSV lens correction was cancelled.');
        new LensOverrides(path.join(this.homedir, 'lens-overrides.json')).set(insvIdentity(pair), value);
        return { success: true, thumpName, lensFieldOfView: fieldOfView, lensFovOverride: value !== null };
      });
    } catch (error) {
      return { success: false, message: error?.message || 'Unable to save the INSV lens correction.' };
    } finally {
      if (this.insvLensRequests.get(origPath) === request) this.insvLensRequests.delete(origPath);
      this.insvLensBusy = false;
    }
  }

  saveInsvLensFov(value) {
    if (!isValidLensFov(value)) {
      return { success: false, message: 'INSV lens FOV must be 180–220 degrees in 0.1 degree steps.' };
    }
    try {
      const settings = { ...this.config.getSettings(), insvLensFov: value };
      this.config.loadSettings(settings);
      return { success: true, insvLensFov: value };
    } catch (error) {
      return { success: false, message: error?.message || 'Unable to save the INSV lens FOV.' };
    }
  }

  saveInspLensFov(value) {
    if (!isValidLensFov(value)) {
      return { success: false, message: 'INSP lens FOV must be 180–220 degrees in 0.1 degree steps.' };
    }
    try {
      this.config.loadSettings({ ...this.config.getSettings(), inspLensFov: value });
      return { success: true, inspLensFov: value };
    } catch (error) {
      return { success: false, message: error?.message || 'Unable to save the INSP lens FOV.' };
    }
  }

  inspCorrections() {
    return new InspCorrections(path.join(this.homedir, 'insp-corrections.json'));
  }

  confirmLegacyInsp(isCurrent) {
    const operation = this.inspPromptQueue.then(async () => {
      if (!isCurrent()) throw new Error('The INSP operation was cancelled.');
      const { response } = await dialog.showMessageBox(this.win, {
        type: 'warning',
        buttons: ['Keep old image', 'Restitch'],
        defaultId: 0,
        cancelId: 0,
        message: 'This photo has an older cached panorama.',
        detail:
          'It may contain an orientation correction that cannot be recovered, and may not reflect changes to the original. Restitching cannot preserve the old correction. The old cached image will not be deleted.',
      });
      if (!isCurrent()) throw new Error('The INSP operation was cancelled.');
      return response === 1;
    });
    this.inspPromptQueue = operation.then(
      () => undefined,
      () => undefined
    );
    return operation;
  }

  cancelInspLensCorrection(payload) {
    const request = this.inspRequests.get(payload?.origPath);
    if (request && request.id === payload?.requestId) {
      request.controller.abort();
      this.inspRequests.delete(payload.origPath);
    }
  }

  async updateInsp(origPath, requestId, makeCorrection) {
    const current = this.inspMedia.get(origPath);
    const previous = this.exportMedia.get(origPath);
    if (!current || !previous || this.authorizedMedia.get(origPath) !== 'image') {
      throw new Error('This INSP photo is no longer available.');
    }
    if (this.inspBusy) throw new Error('Another INSP correction is still processing.');
    const generation = this.directoryImportGeneration;
    const request = { id: requestId, controller: new AbortController() };
    this.inspRequests.set(origPath, request);
    this.inspBusy = true;
    const isCurrent = () =>
      !request.controller.signal.aborted &&
      this.inspRequests.get(origPath) === request &&
      this.inspMedia.get(origPath) === current &&
      this.exportMedia.get(origPath) === previous &&
      this.directoryImportGeneration === generation &&
      this.authorizedMedia.get(origPath) === 'image';
    try {
      assertCurrentInsp(origPath, current.snapshot);
      if (current.legacy && !(await this.confirmLegacyInsp(isCurrent))) {
        throw new Error('Restitching was cancelled; the old image was kept.');
      }
      const { correction, fieldOfView } = makeCorrection(current);
      const result = await Media.renderInsta360Image(origPath, {
        snapshot: current.snapshot,
        fieldOfView,
        rotations: correction.rotations,
        signal: request.controller.signal,
        isCurrent,
      });
      assertCurrentInsp(origPath, current.snapshot);
      if (!isCurrent()) throw new Error('The INSP correction was cancelled.');
      this.recordExportMedia(origPath, result.bigName);
      try {
        this.inspCorrections().set(current.identity, correction);
      } catch (error) {
        this.exportMedia.set(origPath, previous);
        throw error;
      }
      this.inspMedia.set(origPath, { ...current, correction, fieldOfView, legacy: false });
      return { ...result, lensFieldOfView: fieldOfView, lensFovOverride: correction.override !== null };
    } finally {
      if (this.inspRequests.get(origPath) === request) this.inspRequests.delete(origPath);
      this.inspBusy = false;
    }
  }

  async saveInspLensCorrection(payload) {
    const { origPath, requestId, value } = payload || {};
    if (
      typeof origPath !== 'string' ||
      !Number.isSafeInteger(requestId) ||
      requestId <= 0 ||
      (value !== null && !isValidLensFov(value))
    ) {
      return { success: false, message: 'This INSP photo or lens correction is invalid.' };
    }
    try {
      const result = await this.updateInsp(origPath, requestId, (current) => ({
        correction: { ...current.correction, override: value },
        fieldOfView: value === null ? this.config.getSettings().inspLensFov : value,
      }));
      return { success: true, ...result };
    } catch (error) {
      return { success: false, message: error?.message || 'Unable to save the INSP lens correction.' };
    }
  }

  async saveLegacyInspOrientation(origPath, requestId, orientation, current) {
    if (this.inspBusy) throw new Error('Another INSP correction is still processing.');
    const previous = this.exportMedia.get(origPath);
    if (!previous) throw new Error('This INSP photo is not ready.');
    const generation = this.directoryImportGeneration;
    const request = { id: requestId, controller: new AbortController() };
    this.inspRequests.set(origPath, request);
    this.inspBusy = true;
    const isCurrent = () => {
      if (
        request.controller.signal.aborted ||
        this.inspRequests.get(origPath) !== request ||
        this.inspMedia.get(origPath) !== current ||
        this.exportMedia.get(origPath) !== previous ||
        this.directoryImportGeneration !== generation ||
        this.authorizedMedia.get(origPath) !== 'image'
      )
        return false;
      assertCurrentInsp(origPath, current.snapshot);
      return true;
    };
    try {
      this.validateExportMedia(origPath, previous);
      const result = await Media.saveInsta360OrientationCorrection(origPath, orientation, {
        signal: request.controller.signal,
        isCurrent: () => {
          if (!isCurrent()) return false;
          this.validateExportMedia(origPath, previous);
          return true;
        },
      });
      if (!isCurrent()) throw new Error('The INSP orientation correction was cancelled.');
      this.recordExportMedia(origPath, result.bigName);
      return result;
    } finally {
      if (this.inspRequests.get(origPath) === request) this.inspRequests.delete(origPath);
      this.inspBusy = false;
    }
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
    const insp = this.inspMedia.get(origPath);
    if (insp) assertCurrentInsp(origPath, insp.snapshot);
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
      const defaultPath = exportFileName(origPath, extension);
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
          const name = exportFileName(entry.origPath, path.extname(entry.record.bigName));
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
        await renameWithRetry(tempPath, filePath);
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
      const insp = this.inspMedia.get(origPath);
      if (path.extname(origPath).toLowerCase() === '.insp' && !insp) {
        throw new Error('This INSP photo is not ready.');
      }
      if (insp) {
        if (!Number.isSafeInteger(payload.requestId) || payload.requestId <= 0 || !isValidRotation(orientation)) {
          throw new Error('Invalid INSP orientation request.');
        }
        const result = insp.legacy
          ? await this.saveLegacyInspOrientation(origPath, payload.requestId, orientation, insp)
          : await this.updateInsp(origPath, payload.requestId, (current) => ({
              correction: { ...current.correction, rotations: [...current.correction.rotations, orientation] },
              fieldOfView: current.fieldOfView,
            }));
        return { success: true, ...result };
      }
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
    this.cancelPendingMedia();
    this.authorizedMedia = new Map();
    this.exportMedia = new Map();
    this.insvSources.clear();
    this.insvTokens.clear();
    this.inspMedia.clear();
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

  async prepareInsp(origPath, defaultFov, token, importGeneration) {
    const snapshot = snapshotInsp(origPath);
    const identity = inspIdentity(origPath, snapshot);
    const stored = this.inspCorrections().get(identity);
    const correction = stored || { override: null, rotations: [] };
    const isCurrent = () =>
      !token.controller.signal.aborted &&
      importGeneration === this.directoryImportGeneration &&
      this.pendingMedia.get(origPath) === token &&
      this.authorizedMedia.get(origPath) === 'image';
    let legacy = !stored && Media.hasLegacyInsta360Image(origPath, this.static_dir);
    if (legacy && (await this.confirmLegacyInsp(isCurrent))) legacy = false;
    if (!isCurrent()) throw new Error('The INSP import was cancelled.');
    const fieldOfView = legacy ? 199 : correction.override === null ? defaultFov : correction.override;
    let result;
    if (legacy) {
      result = await Media.saveInsta360Image(origPath, null, null, { signal: token.controller.signal });
      if (result.error) throw result.error;
    } else {
      result = await Media.renderInsta360Image(origPath, {
        snapshot,
        fieldOfView,
        rotations: correction.rotations,
        signal: token.controller.signal,
        isCurrent,
      });
    }
    assertCurrentInsp(origPath, snapshot);
    if (!isCurrent()) throw new Error('The INSP import was cancelled.');
    token.inspState = { snapshot, identity, correction, fieldOfView, legacy, persistInitial: !legacy && !stored };
    return {
      ...result,
      insp: true,
      lensFieldOfView: fieldOfView,
      lensFovOverride: correction.override !== null,
      legacyInsp: legacy,
    };
  }

  async prepareMedia(files, append, importGeneration) {
    const importSignal = this.importController.signal;
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
    const usesLensFov = work.some(
      (item) => item.insvPair || path.extname(item.origPath || '').toLowerCase() === '.insp'
    );
    const settings = usesLensFov ? this.config.getSettings() : {};
    const insvLensFov = settings.insvLensFov;
    const inspLensFov = settings.inspLensFov;
    this.win?.webContents?.send(append ? 'start-read-files' : 'start-read-dir', work.length);
    if (!work.length && !append) this.win?.webContents?.send('open-dir', false);
    const exifSyncs = new Map();
    await Promise.all(
      work.map(({ filePath, origPath, error, insvPair }) => {
        if (insvPair) {
          return this.enqueueInsvJob(async () => {
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
              const override = new LensOverrides(path.join(this.homedir, 'lens-overrides.json')).get(
                insvIdentity(pair)
              );
              const fieldOfView = override === undefined ? insvLensFov : override;
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
              const thumpName = await createInsvThumbnail(
                pair,
                path.join(this.static_dir, 'small'),
                rotation,
                fieldOfView,
                { signal: importSignal }
              );
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
                lensFieldOfView: fieldOfView,
                lensFovOverride: override !== undefined,
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
        }
        return new Promise((resolve) => {
          if (error) {
            this.win?.webContents?.send('read-media-file', { error: { message: error }, origPath: filePath });
            resolve();
            return;
          }
          const ext = path.extname(filePath).slice(1).toLowerCase();
          const type = ext === 'mp4' ? 'video' : 'image';
          const token = ext === 'insp' ? { controller: new AbortController() } : {};
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
              this.inspMedia.delete(origPath);
            } else if (result && result.bigName) {
              try {
                const record = this.recordExportMedia(origPath, result.bigName);
                if (
                  type === 'image' &&
                  (!token.inspState || token.inspState.legacy) &&
                  !fs.lstatSync(record.cachePath).isSymbolicLink()
                ) {
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
                if (token.inspState) {
                  assertCurrentInsp(origPath, token.inspState.snapshot);
                  if (!isCurrent()) throw new Error('The INSP import was cancelled.');
                  if (token.inspState.persistInitial) {
                    this.inspCorrections().set(token.inspState.identity, token.inspState.correction);
                  }
                  this.inspMedia.set(origPath, token.inspState);
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
                this.inspMedia.delete(origPath);
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
              operation = this.prepareInsp(origPath, inspLensFov, token, importGeneration).then(sendMediaResult);
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

  // Moves the original file to the Recycle Bin/Trash (never a permanent unlink), then drops its cache.
  // Only files authorized by an import can be deleted, and a failed trash keeps the item in the library.
  async deleteSelected(dataArray = []) {
    for (const item of dataArray) {
      if (this.authorizedMedia.get(item.origPath) === 'insv') {
        this.win?.webContents?.send('delete-error', { message: 'Deleting INSV pairs is not available.' });
        continue;
      }
      if (!this.authorizedMedia.has(item.origPath)) {
        this.win?.webContents?.send('delete-error', { message: 'This media file is not part of the current library.' });
        continue;
      }

      const validName = (name) =>
        typeof name === 'string' && name !== '' && name === path.basename(name) && name !== '.' && name !== '..';
      if (!validName(item.thumpName) || !validName(item.bigName)) {
        this.win?.webContents?.send('delete-error', { message: 'Invalid cache file name.' });
        continue;
      }

      try {
        // Windows trashItem fails with "Operation was aborted" on forward-slash paths
        const trashPath = path.resolve(item.origPath);
        for (let attempt = 0; ; attempt += 1) {
          try {
            await shell.trashItem(trashPath);
            break;
          } catch (error) {
            if (attempt >= 2 || !Helper.isFileExists(trashPath)) throw error;
            await new Promise((resolve) => setTimeout(resolve, 200 * (attempt + 1)));
          }
        }
      } catch (error) {
        // Only a file that is really gone counts as deleted; ENOENT from a broken trash backend does not.
        if (Helper.isFileExists(item.origPath)) {
          this.win?.webContents?.send('delete-error', {
            message: `Unable to move ${path.basename(item.origPath)} to the trash: ${error.message}`,
          });
          continue;
        }
      }

      this.authorizedMedia.delete(item.origPath);
      this.exportMedia.delete(item.origPath);
      this.inspRequests.get(item.origPath)?.controller.abort();
      this.inspRequests.delete(item.origPath);
      this.inspMedia.delete(item.origPath);
      this.pendingMedia.get(item.origPath)?.controller?.abort();
      this.pendingMedia.delete(item.origPath);
      mediaCache.unregisterSource(item.bigName);
      const thumpPath = this.static_dir + '/small/' + item.thumpName;
      const symlPath = this.static_dir + '/big/' + item.bigName;

      for (const cacheFile of [thumpPath, symlPath]) {
        try {
          await fs.promises.unlink(cacheFile);
        } catch (error) {
          if (error.code !== 'ENOENT') this.win?.webContents?.send('delete-error', error);
        }
      }

      this.win?.webContents?.send('file-deleted', item);
    }

    return true;
  }

  removeFromLibrary(items) {
    if (!Array.isArray(items)) return;
    for (const item of items) {
      if (typeof item?.origPath !== 'string') continue;
      const token = this.insvTokens.get(item.origPath);
      this.insvLensRequests.get(item.origPath)?.controller.abort();
      this.insvLensRequests.delete(item.origPath);
      if (token) this.insvSources.revoke(token);
      this.insvTokens.delete(item.origPath);
      this.authorizedMedia.delete(item.origPath);
      this.exportMedia.delete(item.origPath);
      this.inspRequests.get(item.origPath)?.controller.abort();
      this.inspRequests.delete(item.origPath);
      this.inspMedia.delete(item.origPath);
      this.pendingMedia.get(item.origPath)?.controller?.abort();
      this.pendingMedia.delete(item.origPath);
    }
  }

  async requestDeleteCache(event, items = []) {
    try {
      let names;
      if (!Array.isArray(items) || !items.length) {
        try {
          names = fs.readdirSync(path.join(this.static_dir, 'big'));
        } catch (error) {
          if (error.code !== 'ENOENT') throw error;
          names = [];
        }
      } else {
        names = items.map((item) => item?.bigName);
      }
      if (names.some((name) => typeof name === 'string' && /-insta360-v6\.jpg$/i.test(name))) {
        const win = this.win;
        const generation = this.directoryImportGeneration;
        const { response } = await dialog.showMessageBox(win, {
          type: 'warning',
          buttons: ['Cancel', 'Clear cache'],
          defaultId: 0,
          cancelId: 0,
          message: 'Clearing the cache may remove older INSP orientation corrections.',
          detail: 'Those corrections are stored only in the old cached images and cannot be restored.',
        });
        if (response !== 1 || this.win !== win || this.directoryImportGeneration !== generation) return;
      }
      this.deleteCache(event, items);
    } catch (error) {
      event.reply('delete-error', { message: error?.message || 'Unable to clear the data cache.' });
    }
  }

  deleteCache(event, items = []) {
    this.directoryImportGeneration += 1;
    this.cancelPendingMedia();
    this.authorizedMedia.clear();
    this.exportMedia.clear();
    this.insvSources.clear();
    this.insvTokens.clear();
    this.inspMedia.clear();
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
