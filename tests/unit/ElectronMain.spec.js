const fs = require('fs');
const os = require('os');
const path = require('path');

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
    expect(main.getDirectoryFromArgv(['/app/360-media-viewer', `file://${encodeURI(spacedDirectory)}`])).toBe(
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

  test('declares supported media and directory MIME types for Linux packaging', () => {
    const config = require('../../electron-builder.json');

    expect(config.linux.mimeTypes).toEqual(['inode/directory', 'image/jpeg', 'image/png', 'video/mp4']);
    expect(config.fileAssociations).toEqual([
      expect.objectContaining({ ext: 'insp', mimeType: 'image/x-360-media-viewer-insp' }),
    ]);
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
