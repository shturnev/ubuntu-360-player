const fs = require('fs');
const os = require('os');
const path = require('path');

function loadMain({ isPackaged = true, hasSingleInstanceLock = true } = {}) {
  jest.resetModules();

  let readyCallback;
  const windows = [];
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
    this.loadFile = jest.fn(() => Promise.resolve());
    this.webContents = { send: jest.fn(), openDevTools: jest.fn() };
    windows.push(this);
  });
  BrowserWindow.getAllWindows = jest.fn(() => windows);
  const appModel = { init: jest.fn(), readDir: jest.fn(), savePanoramaScreenshot: jest.fn() };
  const MainModelClass = jest.fn(() => appModel);

  jest.doMock('electron', () => ({
    app,
    BrowserWindow,
    Menu: {
      buildFromTemplate: jest.fn(() => ({ getMenuItemById: jest.fn(() => ({ checked: false })) })),
      setApplicationMenu: jest.fn(),
    },
    ipcMain: { handle: jest.fn() },
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

    expect(appModel.readDir).toHaveBeenCalledTimes(1);
    expect(appModel.readDir).toHaveBeenCalledWith(directory);
    expect(windows[0].webContents.send).toHaveBeenCalledWith('open-dir', directory);
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
    expect(appModel.readDir).toHaveBeenCalledWith(directory);
    expect(appModel.init.mock.invocationCallOrder[0]).toBeLessThan(appModel.readDir.mock.invocationCallOrder[0]);
  });

  test('declares only the directory MIME type for Linux packaging', () => {
    const config = require('../../electron-builder.json');

    expect(config.linux.mimeTypes).toEqual(['inode/directory']);
    expect(config.fileAssociations).toBeUndefined();
  });
});
