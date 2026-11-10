const fs = require('fs');
const os = require('os');
const path = require('path');

jest.mock('electron', () => ({
  dialog: { showOpenDialogSync: jest.fn() },
  ipcMain: { on: jest.fn() }
}));

const { dialog } = require('electron');

jest.mock('trash', () => jest.fn(async () => true));

const { MainModelClass, removeFilesHelper } = require('../../src/models/MainModelClass');
const { Media } = require('../../src/models/Media');

describe('MainModelClass', () => {
  let tempDir;
  let mainModelClass;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sht-vr-main-'));
    const staticDir = path.join(tempDir, '.sht-vr-player', 'static');
    fs.mkdirSync(path.join(staticDir, 'small'), { recursive: true });
    fs.mkdirSync(path.join(staticDir, 'big'), { recursive: true });

    mainModelClass = new MainModelClass({ webContents: { send: jest.fn() } });
    mainModelClass.static_dir = staticDir;
    mainModelClass.homedir = path.join(tempDir, '.sht-vr-player');
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    jest.restoreAllMocks();
  });

  test('deleteSelected removes files and returns true', async () => {
    const targetDir = mainModelClass.static_dir;
    const thumpFile = path.join(targetDir, 'small', 'thumb.png');
    const bigFile = path.join(targetDir, 'big', 'big.png');
    const originalFile = path.join(tempDir, 'original.png');

    fs.writeFileSync(thumpFile, 'thumb');
    fs.writeFileSync(bigFile, 'big');
    fs.writeFileSync(originalFile, 'image');

    const payload = [{
      thumpName: 'thumb.png',
      bigName: 'big.png',
      origPath: originalFile,
      selected: true,
      type: 'image'
    }];

    const result = mainModelClass.deleteSelected(payload);
    expect(result).toBe(true);
    expect(fs.existsSync(thumpFile)).toBe(false);
    expect(fs.existsSync(bigFile)).toBe(false);
  });

  test('removeFilesHelper keeps files that are still present in the selected list', () => {
    const smallDir = path.join(mainModelClass.static_dir, 'small');
    fs.writeFileSync(path.join(smallDir, 'keep.png'), 'keep');
    fs.writeFileSync(path.join(smallDir, 'remove.png'), 'remove');

    removeFilesHelper(smallDir, ['keep.png']);

    expect(fs.existsSync(path.join(smallDir, 'keep.png'))).toBe(true);
    expect(fs.existsSync(path.join(smallDir, 'remove.png'))).toBe(false);
  });

  test('readDir processes each supported media file once and reports the matching total', async () => {
    const sourceDir = path.join(tempDir, 'media');
    fs.mkdirSync(sourceDir);
    fs.writeFileSync(path.join(sourceDir, 'first.jpg'), 'image');
    fs.writeFileSync(path.join(sourceDir, 'second.png'), 'image');
    fs.writeFileSync(path.join(sourceDir, 'third.mp4'), 'video');
    fs.writeFileSync(path.join(sourceDir, 'ignored.txt'), 'text');
    const send = jest.fn();
    mainModelClass.win.webContents.send = send;
    const saveImage = jest.spyOn(Media, 'saveImage').mockImplementation(() => {});
    const saveVideo = jest.spyOn(Media, 'saveVideo').mockImplementation(() => {});

    await new Promise((resolve) => {
      send.mockImplementation((channel) => {
        if (channel === 'start-read-dir') resolve();
      });
      mainModelClass.readDir(sourceDir);
    });

    expect(send).toHaveBeenCalledWith('start-read-dir', 3);
    expect(saveImage.mock.calls.map(([file]) => path.basename(file)).sort()).toEqual(['first.jpg', 'second.png']);
    expect(saveVideo.mock.calls.map(([file]) => path.basename(file))).toEqual(['third.mp4']);
  });

  test('readDir keeps the empty-directory behavior when no media files are supported', async () => {
    const sourceDir = path.join(tempDir, 'empty-media');
    fs.mkdirSync(sourceDir);
    fs.writeFileSync(path.join(sourceDir, 'notes.txt'), 'text');
    const send = jest.fn();
    mainModelClass.win.webContents.send = send;

    await new Promise((resolve) => {
      send.mockImplementation((channel) => {
        if (channel === 'open-dir') resolve();
      });
      mainModelClass.readDir(sourceDir);
    });

    expect(send).toHaveBeenCalledWith('start-read-dir', 0);
    expect(send).toHaveBeenCalledWith('open-dir', false);
  });

  test('deleteCache removes the cache directory and only reports completion on success', async () => {
    const smallDir = path.join(mainModelClass.static_dir, 'small');
    const bigDir = path.join(mainModelClass.static_dir, 'big');
    fs.writeFileSync(path.join(smallDir, 'thumb.png'), 'thumb');
    fs.writeFileSync(path.join(bigDir, 'full.png'), 'full');

    const event = { reply: jest.fn() };
    mainModelClass.deleteCache(event, []);

    await new Promise((resolve) => setTimeout(resolve, 25));

    expect(fs.existsSync(mainModelClass.static_dir)).toBe(false);
    expect(event.reply).toHaveBeenCalledWith('delete-cache-finish', true);
  });

  test('openDir preserves the cancellation behavior without reading a directory', () => {
    jest.spyOn(dialog, 'showOpenDialogSync').mockReturnValue(undefined);
    const event = { reply: jest.fn() };
    const readDir = jest.spyOn(mainModelClass, 'readDir');

    expect(mainModelClass.openDir(event)).toBe(false);
    expect(event.reply).toHaveBeenCalledWith('open-dir', false);
    expect(readDir).not.toHaveBeenCalled();
  });
});
