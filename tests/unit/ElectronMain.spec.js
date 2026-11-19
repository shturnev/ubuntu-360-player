const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');

function loadMain({ isPackaged = true, hasSingleInstanceLock = true } = {}) {
  jest.resetModules();

  let readyCallback;
  const windows = [];
  const ipcMain = { on: jest.fn(), handle: jest.fn() };
  const app = {
    isPackaged,
    on: jest.fn(),
    quit: jest.fn(),
    requestSingleInstanceLock: jest.fn(() => hasSingleInstanceLock),
    setDesktopName: jest.fn(),
    whenReady: jest.fn(() => ({
      then: (callback) => {
        readyCallback = callback;
        return callback;
      },
    })),
  };
  const BrowserWindow = jest.fn(function BrowserWindow() {
    this.isDestroyed = jest.fn(() => false);
    this.isMinimized = jest.fn(() => true);
    this.restore = jest.fn();
    this.show = jest.fn();
    this.focus = jest.fn();
    this.on = jest.fn();
    this.loadFile = jest.fn(() => {
      const handler = ipcMain.on.mock.calls.find(([channel]) => channel === 'renderer-ready')?.[1];
      if (handler) handler({ sender: this.webContents });
      return Promise.resolve();
    });
    this.webContents = { send: jest.fn(), openDevTools: jest.fn(), on: jest.fn(), setIgnoreMenuShortcuts: jest.fn() };
    windows.push(this);
  });
  BrowserWindow.getAllWindows = jest.fn(() => windows);
  const appModel = {
    init: jest.fn(),
    setWindow: jest.fn(),
    readDir: jest.fn(),
    enqueueExternalImport: jest.fn(),
    drainExternalImports: jest.fn(),
    setExternalImportReady: jest.fn(),
    savePanoramaScreenshot: jest.fn(),
    saveCurrentMedia: jest.fn(),
    saveSelectedMedia: jest.fn(),
    saveInsvLensFov: jest.fn(),
    saveInsvLensCorrection: jest.fn(),
    cancelInsvLensCorrection: jest.fn(),
    saveInspLensFov: jest.fn(),
    saveInspLensCorrection: jest.fn(),
    cancelInspLensCorrection: jest.fn(),
    saveOrientationCorrection: jest.fn(),
  };
  const MainModelClass = jest.fn(() => appModel);

  jest.doMock('electron', () => ({
    app,
    BrowserWindow,
    Menu: {
      buildFromTemplate: jest.fn(() => ({ getMenuItemById: jest.fn(() => ({ checked: false })) })),
      setApplicationMenu: jest.fn(),
    },
    ipcMain,
    shell: { openExternal: jest.fn() },
  }));
  jest.doMock('../../src/models/MainModelClass', () => ({ MainModelClass }));

  return {
    app,
    appModel,
    BrowserWindow,
    getReadyCallback: () => readyCallback,
    main: require('../../electron/main'),
    windows,
  };
}

describe('Electron main process directory launch flow', () => {
  let tempDir;
  let originalArgv;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sht-vr-electron-main-'));
    originalArgv = process.argv;
  });

  afterEach(() => {
    process.argv = originalArgv;
    fs.rmSync(tempDir, { recursive: true, force: true });
    jest.resetModules();
    jest.clearAllMocks();
  });

  test('parses the first valid production directory path and file URI', () => {
    const firstDirectory = path.join(tempDir, 'first');
    const spacedDirectory = path.join(tempDir, 'media library');
    fs.mkdirSync(firstDirectory);
    fs.mkdirSync(spacedDirectory);
    const { main } = loadMain();

    expect(main.getDirectoryFromArgv(['/app/360-media-viewer', firstDirectory, spacedDirectory])).toBe(firstDirectory);
    expect(main.getDirectoryFromArgv(['/app/360-media-viewer', pathToFileURL(spacedDirectory).href])).toBe(
      spacedDirectory
    );
  });

  test('ignores development bootstrap, flags, files, missing paths, non-file URIs, and malformed URIs', () => {
    const regularFile = path.join(tempDir, 'photo.jpg');
    fs.writeFileSync(regularFile, 'image');
    const { main } = loadMain({ isPackaged: false });

    expect(main.getDirectoryFromArgv(['/usr/bin/electron', '.'], { isDevelopment: true })).toBe(null);
    expect(main.getDirectoryFromArgv(['/usr/bin/electron', '.', tempDir], { isDevelopment: true })).toBe(tempDir);
    expect(main.getDirectoryFromArgv(['/app/360-media-viewer', '--inspect', regularFile])).toBe(null);
    expect(main.getDirectoryFromArgv(['/app/360-media-viewer', regularFile])).toBe(null);
    expect(main.getDirectoryFromArgv(['/app/360-media-viewer', path.join(tempDir, 'missing')])).toBe(null);
    expect(main.getDirectoryFromArgv(['/app/360-media-viewer', 'https://example.test/media'])).toBe(null);
    expect(main.getDirectoryFromArgv(['/app/360-media-viewer', 'file://%zz'])).toBe(null);
  });

  test('acquires the single-instance lock before registering ready initialization', () => {
    process.argv = ['/app/360-media-viewer'];
    const { app } = loadMain();

    expect(app.requestSingleInstanceLock).toHaveBeenCalledTimes(1);
    expect(app.requestSingleInstanceLock.mock.invocationCallOrder[0]).toBeLessThan(
      app.whenReady.mock.invocationCallOrder[0]
    );
  });

  test('quits without initializing the application when another instance holds the lock', () => {
    process.argv = ['/app/360-media-viewer'];
    const { app, BrowserWindow } = loadMain({ hasSingleInstanceLock: false });

    expect(app.quit).toHaveBeenCalledTimes(1);
    expect(app.whenReady).not.toHaveBeenCalled();
    expect(BrowserWindow).not.toHaveBeenCalled();
  });

  test('imports and focuses a directory passed to a second instance', async () => {
    const directory = path.join(tempDir, 'media');
    fs.mkdirSync(directory);
    process.argv = ['/app/360-media-viewer'];
    const { app, appModel, getReadyCallback, windows } = loadMain();

    await getReadyCallback()();
    const secondInstanceHandler = app.on.mock.calls.find(([event]) => event === 'second-instance')[1];
    secondInstanceHandler({}, ['/app/360-media-viewer', directory]);

    expect(appModel.enqueueExternalImport).toHaveBeenCalledWith({ directory, files: [] });
    expect(windows[0].restore).toHaveBeenCalledTimes(1);
    expect(windows[0].show).toHaveBeenCalledTimes(1);
    expect(windows[0].focus).toHaveBeenCalledTimes(1);
  });

  test('does not import or focus for an invalid second-instance argument', async () => {
    process.argv = ['/app/360-media-viewer'];
    const { app, appModel, getReadyCallback, windows } = loadMain();

    await getReadyCallback()();
    const secondInstanceHandler = app.on.mock.calls.find(([event]) => event === 'second-instance')[1];
    secondInstanceHandler({}, ['/app/360-media-viewer', path.join(tempDir, 'missing')]);

    expect(appModel.readDir).not.toHaveBeenCalled();
    expect(windows[0].show).not.toHaveBeenCalled();
    expect(windows[0].focus).not.toHaveBeenCalled();
  });

  test('waits for window loading and model initialization before importing the initial directory', async () => {
    const directory = path.join(tempDir, 'media');
    fs.mkdirSync(directory);
    process.argv = ['/app/360-media-viewer', directory];
    const { appModel, BrowserWindow, getReadyCallback, main } = loadMain();

    expect(main.getDirectoryFromArgv(process.argv)).toBe(directory);
    await getReadyCallback()();

    expect(BrowserWindow).toHaveBeenCalledTimes(1);
    expect(appModel.init).toHaveBeenCalledTimes(1);
    expect(appModel.enqueueExternalImport).toHaveBeenCalledWith({ directory, files: [] });
    expect(appModel.init.mock.invocationCallOrder[0]).toBeLessThan(
      appModel.enqueueExternalImport.mock.invocationCallOrder[0]
    );
  });

  test('reserves app shortcuts from the menu without affecting other accelerators', async () => {
    process.argv = ['/app/360-media-viewer'];
    const { getReadyCallback, windows } = loadMain();
    await getReadyCallback()();
    const contents = windows[0].webContents;
    const handler = contents.on.mock.calls.find(([name]) => name === 'before-input-event')[1];
    for (const key of ['o', 'P', 's']) {
      handler({}, { key, control: true, alt: false, shift: false, meta: false });
      expect(contents.setIgnoreMenuShortcuts).toHaveBeenLastCalledWith(true);
    }
    handler({}, { key: 'F1', control: false, alt: false, shift: false, meta: false });
    expect(contents.setIgnoreMenuShortcuts).toHaveBeenLastCalledWith(true);
    handler({}, { key: 'r', control: true, alt: false, shift: false, meta: false });
    expect(contents.setIgnoreMenuShortcuts).toHaveBeenLastCalledWith(false);
    handler({}, { key: 'щ', code: 'KeyO', control: true, alt: false, shift: false, meta: false });
    expect(contents.setIgnoreMenuShortcuts).toHaveBeenLastCalledWith(true);
    handler({}, { key: 'Щ', code: 'KeyO', control: true, alt: false, shift: true, meta: false });
    expect(contents.setIgnoreMenuShortcuts).toHaveBeenLastCalledWith(true);
    handler({}, { key: 'p', control: true, alt: false, shift: true, meta: false });
    expect(contents.setIgnoreMenuShortcuts).toHaveBeenLastCalledWith(false);
    handler({}, { key: 'o', code: 'KeyA', control: true, alt: false, shift: false, meta: false });
    expect(contents.setIgnoreMenuShortcuts).toHaveBeenLastCalledWith(false);
  });

  test('reuses the model and registers export IPC only once when a window is recreated', async () => {
    process.argv = ['/app/360-media-viewer'];
    const { appModel, getReadyCallback, main, windows } = loadMain();
    const { ipcMain } = require('electron');
    await getReadyCallback()();
    const closed = windows[0].on.mock.calls.find(([name]) => name === 'closed')[1];
    closed();
    await main.createWindow();
    expect(appModel.init).toHaveBeenCalledTimes(1);
    expect(appModel.setWindow).toHaveBeenCalledWith(windows[1]);
    expect(ipcMain.handle.mock.calls.filter(([name]) => name === 'save-current-media')).toHaveLength(1);
    const handler = ipcMain.handle.mock.calls.find(([name]) => name === 'save-current-media')[1];
    appModel.saveCurrentMedia.mockResolvedValue({ cancelled: true });
    await expect(handler({}, { origPath: '/media/a.jpg' })).resolves.toEqual({ cancelled: true });
    expect(ipcMain.handle.mock.calls.filter(([name]) => name === 'save-selected-media')).toHaveLength(1);
    const selectedHandler = ipcMain.handle.mock.calls.find(([name]) => name === 'save-selected-media')[1];
    const sender = { isDestroyed: jest.fn(() => false), send: jest.fn() };
    appModel.saveSelectedMedia.mockImplementation(async (_paths, progress) => {
      progress({ complete: 0, total: 1 });
      sender.isDestroyed.mockReturnValue(true);
      progress({ complete: 1, total: 1 });
      return { success: true, saved: 1, errors: [] };
    });
    await expect(selectedHandler({ sender }, ['/media/a.jpg'], 42)).resolves.toEqual({
      success: true,
      saved: 1,
      errors: [],
    });
    expect(appModel.saveSelectedMedia).toHaveBeenCalledWith(['/media/a.jpg'], expect.any(Function));
    expect(sender.send).toHaveBeenCalledTimes(1);
    expect(sender.send).toHaveBeenCalledWith('export-progress', { complete: 0, total: 1, requestId: 42 });
  });

  test('reports selection export unavailable before the model is initialized', async () => {
    process.argv = ['/app/360-media-viewer'];
    const { getReadyCallback } = loadMain();
    const ready = getReadyCallback()();
    const { ipcMain } = require('electron');
    const handler = ipcMain.handle.mock.calls.find(([name]) => name === 'save-selected-media')[1];
    await expect(handler({}, ['/media/a.jpg'])).resolves.toEqual({
      success: false,
      message: 'Saving media is unavailable.',
    });

    await ready;
  });

  test('accepts INSV lens settings only from the current application window', async () => {
    process.argv = ['/app/360-media-viewer'];
    const { appModel, getReadyCallback, windows } = loadMain();
    const { ipcMain } = require('electron');
    await getReadyCallback()();
    const handler = ipcMain.handle.mock.calls.find(([name]) => name === 'save-insv-lens-fov')[1];
    appModel.saveInsvLensFov.mockReturnValue({ success: true, insvLensFov: 200 });
    await expect(handler({ sender: {} }, 200)).resolves.toMatchObject({ success: false });
    expect(appModel.saveInsvLensFov).not.toHaveBeenCalled();
    await expect(handler({ sender: windows[0].webContents }, 200)).resolves.toEqual({
      success: true,
      insvLensFov: 200,
    });
    expect(appModel.saveInsvLensFov).toHaveBeenCalledWith(200);
  });

  test('queues dropped files only from the current window and never treats them as a directory import', async () => {
    process.argv = ['/app/360-media-viewer'];
    const { appModel, getReadyCallback, windows, main } = loadMain();
    const { ipcMain } = require('electron');
    await getReadyCallback()();
    const handler = ipcMain.handle.mock.calls.find(([name]) => name === 'import-dropped-files')[1];
    const files = [path.join(tempDir, 'photo.jpg'), path.join(tempDir, 'clip.mp4')];
    expect(handler({ sender: {} }, files)).toMatchObject({ success: false });
    expect(appModel.enqueueExternalImport).not.toHaveBeenCalled();
    expect(handler({ sender: windows[0].webContents }, files)).toEqual({ success: true });
    expect(appModel.enqueueExternalImport).toHaveBeenCalledWith({ files });
    expect(appModel.readDir).not.toHaveBeenCalled();
    windows[0].on.mock.calls.find(([name]) => name === 'closed')[1]();
    await main.createWindow();
    appModel.enqueueExternalImport.mockClear();
    expect(handler({ sender: windows[0].webContents }, files)).toMatchObject({ success: false });
    expect(handler({ sender: windows[1].webContents }, [files[0]])).toEqual({ success: true });
    expect(appModel.enqueueExternalImport).toHaveBeenCalledTimes(1);
    expect(ipcMain.handle.mock.calls.filter(([name]) => name === 'import-dropped-files')).toHaveLength(1);
  });

  test.each([null, [], 'photo.jpg', [null], [42], ['relative.jpg'], ['file:///media/photo.jpg'], ['C:\\bad\0.jpg']])(
    'rejects malformed dropped paths before queueing: %j',
    async (files) => {
      process.argv = ['/app/360-media-viewer'];
      const { appModel, getReadyCallback, windows } = loadMain();
      const { ipcMain } = require('electron');
      await getReadyCallback()();
      const handler = ipcMain.handle.mock.calls.find(([name]) => name === 'import-dropped-files')[1];
      expect(handler({ sender: windows[0].webContents }, files)).toMatchObject({
        success: false,
        message: 'Invalid dropped media file list.',
      });
      expect(appModel.enqueueExternalImport).not.toHaveBeenCalled();
    }
  );

  test('authorizes INSV correction requests and cancellation against the current window', async () => {
    process.argv = ['/app/360-media-viewer'];
    const { appModel, getReadyCallback, windows } = loadMain();
    const { ipcMain } = require('electron');
    await getReadyCallback()();
    const save = ipcMain.handle.mock.calls.find(([name]) => name === 'save-insv-lens-correction')[1];
    const cancel = ipcMain.on.mock.calls.find(([name]) => name === 'cancel-insv-lens-correction')[1];
    const payload = { origPath: '/video/00.INSV', requestId: 1, value: 200 };
    appModel.saveInsvLensCorrection.mockResolvedValue({ success: true });
    await expect(save({ sender: {} }, payload)).resolves.toMatchObject({ success: false });
    cancel({ sender: {} }, payload);
    expect(appModel.saveInsvLensCorrection).not.toHaveBeenCalled();
    expect(appModel.cancelInsvLensCorrection).not.toHaveBeenCalled();
    await expect(save({ sender: windows[0].webContents }, payload)).resolves.toEqual({ success: true });
    cancel({ sender: windows[0].webContents }, payload);
    expect(appModel.cancelInsvLensCorrection).toHaveBeenCalledWith(payload);
  });

  test('authorizes INSP settings, correction, orientation and cancellation against the current window', async () => {
    process.argv = ['/app/360-media-viewer'];
    const { appModel, getReadyCallback, windows } = loadMain();
    const { ipcMain } = require('electron');
    await getReadyCallback()();
    const payload = { origPath: '/image/photo.INSP', requestId: 1, value: 200 };
    const handlers = [
      ['save-insp-lens-fov', 'saveInspLensFov', 200],
      ['save-insp-lens-correction', 'saveInspLensCorrection', payload],
      ['save-orientation-correction', 'saveOrientationCorrection', payload],
    ];
    for (const [channel, method, argument] of handlers) {
      const handler = ipcMain.handle.mock.calls.find(([name]) => name === channel)[1];
      appModel[method].mockResolvedValue({ success: true });
      await expect(handler({ sender: {} }, argument)).resolves.toMatchObject({ success: false });
      expect(appModel[method]).not.toHaveBeenCalled();
      await expect(handler({ sender: windows[0].webContents }, argument)).resolves.toEqual({ success: true });
      expect(appModel[method]).toHaveBeenCalledWith(argument);
    }
    const cancel = ipcMain.on.mock.calls.find(([name]) => name === 'cancel-insp-lens-correction')[1];
    cancel({ sender: {} }, payload);
    expect(appModel.cancelInspLensCorrection).not.toHaveBeenCalled();
    cancel({ sender: windows[0].webContents }, payload);
    expect(appModel.cancelInspLensCorrection).toHaveBeenCalledWith(payload);
  });

  test('declares supported media and directory MIME types for Linux packaging', () => {
    const config = require('../../electron-builder.json');

    expect(config.linux.mimeTypes).toEqual(['inode/directory', 'image/jpeg', 'image/png', 'video/mp4']);
    expect(config.linux.fileAssociations).toEqual([
      expect.objectContaining({ ext: 'insp', mimeType: 'image/x-360-media-viewer-insp' }),
    ]);
    expect(config.deb.depends).not.toContain('python3');
  });

  test('configures a per-user x64 NSIS installer that never claims default applications', () => {
    const config = require('../../electron-builder.json');
    const installer = fs.readFileSync(path.resolve(__dirname, '../../', config.nsis.include), 'utf8');

    expect(config.win.target).toEqual([{ target: 'nsis', arch: ['x64'] }]);
    expect(config.win.icon).toBe('build_resources/icon/png/icon.ico');
    expect(config.nsis).toMatchObject({ oneClick: false, perMachine: false, allowElevation: false });
    // fileAssociations register the file class as the default handler; only "Open with" entries are allowed.
    expect(config.fileAssociations).toBeUndefined();
    expect(config.win.fileAssociations).toBeUndefined();
    for (const ext of ['.jpg', '.jpeg', '.png', '.mp4', '.insp', '.insv']) {
      expect(installer).toContain(`registerOpenWith "${ext}"`);
    }
    expect(installer).not.toMatch(/Software\\Classes\\\.\w+"\s+""/);
    expect(config.publish).toEqual([expect.objectContaining({ provider: 'github' })]);
  });

  test('unpacks bundled media tools and does not ship Squirrel', () => {
    const config = require('../../electron-builder.json');
    const manifest = require('../../package.json');

    for (const name of ['ffmpeg-static', 'ffprobe-static', 'exiftool-vendored.exe', 'sharp', 'exiftool-vendored.pl']) {
      expect(config.asarUnpack).toContain(`node_modules/${name}/**`);
    }
    expect(JSON.stringify(manifest)).not.toContain('squirrel');
  });

  test('packages the shared geometry required by the main-process INSV modules', () => {
    const { FileMatcher } = require('app-builder-lib/out/fileMatcher');
    const config = require('../../electron-builder.json');
    const root = path.resolve(__dirname, '../..');
    const filter = new FileMatcher(root, root, (value) => value, config.files).createFilter();
    for (const moduleName of ['insvThumbnailProjection', 'insvCache']) {
      const modulePath = path.join(root, 'src', 'models', `${moduleName}.js`);
      const geometry = require.resolve('../insvGeometry.json', { paths: [path.dirname(modulePath)] });
      expect(filter(modulePath, fs.statSync(modulePath))).toBe(true);
      expect(filter(geometry, fs.statSync(geometry))).toBe(true);
    }
  });

  test('packages shared lens limits required by main-process FOV validation', () => {
    const { FileMatcher } = require('app-builder-lib/out/fileMatcher');
    const config = require('../../electron-builder.json');
    const root = path.resolve(__dirname, '../..');
    const filter = new FileMatcher(root, root, (value) => value, config.files).createFilter();
    const validator = path.join(root, 'src', 'models', 'lensFov.js');
    const limits = require.resolve('../lensFov.json', { paths: [path.dirname(validator)] });
    expect(filter(validator, fs.statSync(validator))).toBe(true);
    expect(filter(limits, fs.statSync(limits))).toBe(true);
  });

  test('parses multiple file URIs and relative paths using the second process working directory', () => {
    const directory = path.join(tempDir, 'photos');
    const image = path.join(tempDir, 'світлина space.JPG');
    const video = path.join(tempDir, 'movie.mp4');
    fs.mkdirSync(directory);
    fs.writeFileSync(image, 'image');
    fs.writeFileSync(video, 'video');
    const { main } = loadMain();
    const { pathToFileURL } = require('url');
    expect(
      main.getMediaFromArgv(
        ['/app/viewer', 'https://example.com/a.jpg', 'file://%zz', pathToFileURL(image).href, 'movie.mp4', 'photos'],
        { workingDirectory: tempDir }
      )
    ).toEqual({ directory, files: [image, video] });
  });

  test('queues multiple second instance requests before the renderer is ready', async () => {
    const image = path.join(tempDir, 'a.jpg');
    const other = path.join(tempDir, 'b.png');
    fs.writeFileSync(image, 'image');
    fs.writeFileSync(other, 'image');
    process.argv = ['/app/360-media-viewer', image];
    const { app, appModel, getReadyCallback } = loadMain();
    const handler = app.on.mock.calls.find(([event]) => event === 'second-instance')[1];
    handler({}, ['/app/360-media-viewer', 'b.png'], tempDir);
    expect(appModel.enqueueExternalImport).not.toHaveBeenCalled();
    await getReadyCallback()();
    expect(appModel.enqueueExternalImport.mock.calls).toEqual([
      [{ directory: null, files: [image] }],
      [{ directory: null, files: [other] }],
    ]);
  });
});
