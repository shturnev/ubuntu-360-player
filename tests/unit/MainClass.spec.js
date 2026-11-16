const fs = require('fs');
const os = require('os');
const path = require('path');

jest.mock('electron', () => ({
  dialog: { showOpenDialogSync: jest.fn(), showSaveDialog: jest.fn() },
  ipcMain: { on: jest.fn(), handle: jest.fn() },
}));

jest.mock('electron-updater', () => ({
  autoUpdater: {
    on: jest.fn(),
  },
}));

const { dialog, ipcMain } = require('electron');

jest.mock('trash', () => jest.fn(async () => true));

const { MainModelClass, removeFilesHelper } = require('../../src/models/MainModelClass');
const { Media } = require('../../src/models/Media');

describe('MainModelClass', () => {
  let tempDir;
  let mainModelClass;
  const validJpeg = new Uint8Array([
    0xff, 0xd8, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01, 0x00, 0x01, 0x01, 0x01, 0x11, 0x00, 0xff, 0xda, 0x00, 0x08,
    0x01, 0x01, 0x00, 0x00, 0x3f, 0x00, 0x00, 0xff, 0xd9,
  ]).buffer;

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

  test('deleteSelected clears cache files without deleting the original media', async () => {
    const targetDir = mainModelClass.static_dir;
    const thumpFile = path.join(targetDir, 'small', 'thumb.png');
    const bigFile = path.join(targetDir, 'big', 'big.png');
    const originalFile = path.join(tempDir, 'original.png');

    fs.writeFileSync(thumpFile, 'thumb');
    fs.writeFileSync(bigFile, 'big');
    fs.writeFileSync(originalFile, 'image');

    const payload = [
      {
        thumpName: 'thumb.png',
        bigName: 'big.png',
        origPath: originalFile,
        selected: true,
        type: 'image',
      },
    ];

    const result = mainModelClass.deleteSelected(payload);
    expect(result).toBe(true);
    expect(fs.existsSync(thumpFile)).toBe(false);
    expect(fs.existsSync(bigFile)).toBe(false);
    expect(fs.existsSync(originalFile)).toBe(true);
  });

  test('saves orientation correction only for an authorized image', async () => {
    const originalFile = path.join(tempDir, 'panorama.jpg');
    const orientation = { yaw: 15, pitch: -8, roll: 4 };
    mainModelClass.authorizedMedia.set(originalFile, 'image');
    const saveOrientationCorrection = jest
      .spyOn(Media, 'saveOrientationCorrection')
      .mockResolvedValue({ bigName: 'panorama-corrected.jpg' });

    await expect(mainModelClass.saveOrientationCorrection({ origPath: originalFile, orientation })).resolves.toEqual({
      success: true,
      bigName: 'panorama-corrected.jpg',
    });
    expect(saveOrientationCorrection).toHaveBeenCalledWith(originalFile, orientation);

    await expect(
      mainModelClass.saveOrientationCorrection({
        origPath: originalFile,
        orientation: { yaw: 181, pitch: 0, roll: 0 },
      })
    ).resolves.toEqual({
      success: false,
      message: 'This image or orientation correction is invalid.',
    });
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

  test('readDir routes .insp files through the Insta360 converter and preserves image authorization', async () => {
    const sourceDir = path.join(tempDir, 'insta360-media');
    fs.mkdirSync(sourceDir);
    fs.writeFileSync(path.join(sourceDir, 'one-x2.insp'), 'image');
    fs.writeFileSync(path.join(sourceDir, 'one-x2-uppercase.INSP'), 'image');
    fs.writeFileSync(path.join(sourceDir, 'regular.jpg'), 'image');
    const send = jest.fn();
    mainModelClass.win.webContents.send = send;
    const saveImage = jest.spyOn(Media, 'saveImage').mockImplementation(() => {});
    const saveInsta360Image = jest.spyOn(Media, 'saveInsta360Image').mockImplementation(() => Promise.resolve());

    await new Promise((resolve) => {
      send.mockImplementation((channel) => {
        if (channel === 'start-read-dir') resolve();
      });
      mainModelClass.readDir(sourceDir);
    });

    expect(send).toHaveBeenCalledWith('start-read-dir', 3);
    expect(saveImage.mock.calls.map(([file]) => path.basename(file))).toEqual(['regular.jpg']);
    expect(saveInsta360Image.mock.calls.map(([file]) => path.basename(file)).sort()).toEqual([
      'one-x2-uppercase.INSP',
      'one-x2.insp',
    ]);
    expect(mainModelClass.authorizedMedia.get(path.join(sourceDir, 'one-x2.insp'))).toBe('image');
    expect(mainModelClass.authorizedMedia.get(path.join(sourceDir, 'one-x2-uppercase.INSP'))).toBe('image');
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

  test('skips an inaccessible media entry without interrupting the directory import', async () => {
    const sourceDir = path.join(tempDir, 'partially-accessible-media');
    fs.mkdirSync(sourceDir);
    fs.writeFileSync(path.join(sourceDir, 'available.jpg'), 'image');
    fs.symlinkSync(path.join(sourceDir, 'missing.jpg'), path.join(sourceDir, 'dangling.jpg'));
    const send = jest.fn();
    mainModelClass.win.webContents.send = send;
    const saveImage = jest.spyOn(Media, 'saveImage').mockImplementation(() => {});

    await new Promise((resolve) => {
      send.mockImplementation((channel, payload) => {
        if (channel === 'read-media-file' && payload.error) resolve();
      });
      mainModelClass.readDir(sourceDir);
    });

    expect(send).toHaveBeenCalledWith('start-read-dir', 2);
    expect(send).toHaveBeenCalledWith(
      'read-media-file',
      expect.objectContaining({
        origPath: path.join(sourceDir, 'dangling.jpg'),
        error: { message: 'Unable to access this media file.' },
      })
    );
    expect(saveImage).toHaveBeenCalledWith(
      path.join(sourceDir, 'available.jpg'),
      mainModelClass.win,
      expect.any(Function)
    );
  });

  test('ignores delayed media results from a superseded directory import', async () => {
    const firstDirectory = path.join(tempDir, 'first-media');
    const secondDirectory = path.join(tempDir, 'second-media');
    fs.mkdirSync(firstDirectory);
    fs.mkdirSync(secondDirectory);
    fs.writeFileSync(path.join(firstDirectory, 'first.jpg'), 'image');
    fs.writeFileSync(path.join(secondDirectory, 'second.jpg'), 'image');
    const send = jest.fn();
    mainModelClass.win.webContents.send = send;

    const callbacks = new Map();
    const callbackWaiters = new Map();
    const saveImage = jest.spyOn(Media, 'saveImage').mockImplementation((filePath, _win, onResult) => {
      const fileName = path.basename(filePath);
      callbacks.set(fileName, onResult);
      const resolve = callbackWaiters.get(fileName);
      if (resolve) {
        resolve(onResult);
      }
    });
    const waitForCallback = (fileName) =>
      new Promise((resolve) => {
        callbackWaiters.set(fileName, resolve);
      });

    const firstCallbackPromise = waitForCallback('first.jpg');
    mainModelClass.readDir(firstDirectory);
    await firstCallbackPromise;
    const secondCallbackPromise = waitForCallback('second.jpg');
    mainModelClass.readDir(secondDirectory);
    await secondCallbackPromise;

    send.mockClear();
    callbacks.get('first.jpg')({ origPath: path.join(firstDirectory, 'first.jpg') });
    callbacks.get('second.jpg')({ origPath: path.join(secondDirectory, 'second.jpg') });

    expect(saveImage).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith('read-media-file', {
      origPath: path.join(secondDirectory, 'second.jpg'),
    });
  });

  test('keeps current media authorization when a superseded import fails', async () => {
    const firstDirectory = path.join(tempDir, 'first-media');
    const secondDirectory = path.join(tempDir, 'second-media');
    fs.mkdirSync(firstDirectory);
    fs.mkdirSync(secondDirectory);
    const firstFile = path.join(firstDirectory, 'shared.jpg');
    const secondFile = path.join(secondDirectory, 'shared.jpg');
    fs.writeFileSync(firstFile, 'first image');
    fs.writeFileSync(secondFile, 'second image');

    const callbacks = new Map();
    jest.spyOn(Media, 'saveImage').mockImplementation((filePath, _win, onResult) => {
      callbacks.set(filePath, onResult);
    });

    mainModelClass.readDir(firstDirectory);
    await new Promise((resolve) => setTimeout(resolve, 0));
    mainModelClass.readDir(secondDirectory);
    await new Promise((resolve) => setTimeout(resolve, 0));

    callbacks.get(firstFile)({ error: new Error('first import failed') });

    expect(mainModelClass.authorizedMedia.get(secondFile)).toBe('image');
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

  test('returns metadata using the original path as its correlation key', async () => {
    jest.spyOn(Media, 'getMetadata').mockResolvedValue([{ key: 'dimensions', label: 'Dimensions', value: '1 × 1' }]);
    jest.spyOn(mainModelClass, 'startFileServer').mockImplementation(() => {});
    mainModelClass.authorizedMedia.set('/media/photo.jpg', 'image');
    mainModelClass.init();
    const handler = ipcMain.on.mock.calls.filter(([channel]) => channel === 'get-media-metadata').pop()[1];
    const event = { reply: jest.fn() };

    await handler(event, { origPath: '/media/photo.jpg', type: 'image', requestId: 1 });

    expect(event.reply).toHaveBeenCalledWith('media-metadata', {
      origPath: '/media/photo.jpg',
      requestId: 1,
      entries: [{ key: 'dimensions', label: 'Dimensions', value: '1 × 1' }],
    });
  });

  test('requests .insp metadata as image metadata', async () => {
    jest
      .spyOn(Media, 'getMetadata')
      .mockResolvedValue([{ key: 'camera-model', label: 'Camera model', value: 'Insta360 One2' }]);
    jest.spyOn(mainModelClass, 'startFileServer').mockImplementation(() => {});
    mainModelClass.authorizedMedia.set('/media/photo.INSP', 'image');
    mainModelClass.init();
    const handler = ipcMain.on.mock.calls.filter(([channel]) => channel === 'get-media-metadata').pop()[1];
    const event = { reply: jest.fn() };

    await handler(event, { origPath: '/media/photo.INSP', type: 'image', requestId: 2 });

    expect(Media.getMetadata).toHaveBeenCalledWith('/media/photo.INSP', 'image');
    expect(event.reply).toHaveBeenCalledWith('media-metadata', {
      origPath: '/media/photo.INSP',
      requestId: 2,
      entries: [{ key: 'camera-model', label: 'Camera model', value: 'Insta360 One2' }],
    });
  });

  test('returns a controlled metadata error', async () => {
    jest.spyOn(Media, 'getMetadata').mockRejectedValue(new Error('Unable to read image metadata.'));
    jest.spyOn(mainModelClass, 'startFileServer').mockImplementation(() => {});
    mainModelClass.authorizedMedia.set('/media/photo.jpg', 'image');
    mainModelClass.init();
    const handler = ipcMain.on.mock.calls.filter(([channel]) => channel === 'get-media-metadata').pop()[1];
    const event = { reply: jest.fn() };

    await handler(event, { origPath: '/media/photo.jpg', type: 'image', requestId: 1 });

    expect(event.reply).toHaveBeenCalledWith('media-metadata', {
      origPath: '/media/photo.jpg',
      requestId: 1,
      error: 'Unable to read image metadata.',
    });
  });

  test('rejects metadata paths that were not imported into the current library', async () => {
    jest.spyOn(mainModelClass, 'startFileServer').mockImplementation(() => {});
    const getMetadata = jest.spyOn(Media, 'getMetadata');
    mainModelClass.init();
    const handler = ipcMain.on.mock.calls.filter(([channel]) => channel === 'get-media-metadata').pop()[1];
    const event = { reply: jest.fn() };

    await handler(event, { origPath: 'https://example.test/video.mp4', type: 'video', requestId: 1 });

    expect(getMetadata).not.toHaveBeenCalled();
    expect(event.reply).toHaveBeenCalledWith('media-metadata', {
      origPath: 'https://example.test/video.mp4',
      requestId: 1,
      error: 'This media file is not available in the current library.',
    });
  });

  test('saves validated JPEG screenshot bytes through the native save dialog', async () => {
    dialog.showSaveDialog.mockResolvedValue({ canceled: false, filePath: path.join(tempDir, 'panorama.jpg') });
    const writeFile = jest.spyOn(fs.promises, 'writeFile').mockResolvedValue();

    await expect(mainModelClass.savePanoramaScreenshot({ data: validJpeg })).resolves.toEqual({ success: true });

    expect(dialog.showSaveDialog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        defaultPath: expect.stringMatching(/^360-screenshot-\d{4}-\d{2}-\d{2}-\d{6}\.jpg$/),
        filters: [{ name: 'JPEG image', extensions: ['jpg', 'jpeg'] }],
      })
    );
    expect(writeFile).toHaveBeenCalledWith(path.join(tempDir, 'panorama.jpg'), expect.any(Buffer));
  });

  test('does not write screenshots when saving is cancelled or the JPEG payload is invalid', async () => {
    dialog.showSaveDialog.mockResolvedValue({ canceled: true });
    const writeFile = jest.spyOn(fs.promises, 'writeFile').mockResolvedValue();

    await expect(mainModelClass.savePanoramaScreenshot({ data: validJpeg })).resolves.toEqual({ cancelled: true });
    await expect(
      mainModelClass.savePanoramaScreenshot({ data: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]).buffer })
    ).resolves.toEqual({
      success: false,
      message: 'Screenshot data is invalid.',
    });

    expect(writeFile).not.toHaveBeenCalled();
  });

  test('returns a controlled error when the save dialog or file write fails', async () => {
    dialog.showSaveDialog.mockRejectedValue(new Error('dialog failed'));
    await expect(mainModelClass.savePanoramaScreenshot({ data: validJpeg })).resolves.toEqual({
      success: false,
      message: 'Unable to save the 360° screenshot.',
    });

    dialog.showSaveDialog.mockResolvedValue({ canceled: false, filePath: path.join(tempDir, 'panorama.jpg') });
    jest.spyOn(fs.promises, 'writeFile').mockRejectedValue(new Error('disk full'));
    await expect(mainModelClass.savePanoramaScreenshot({ data: validJpeg })).resolves.toEqual({
      success: false,
      message: 'Unable to save the 360° screenshot.',
    });
  });

  test('does not register the screenshot IPC handler when windows are initialized repeatedly', () => {
    jest.spyOn(mainModelClass, 'startFileServer').mockImplementation(() => {});

    mainModelClass.init();
    mainModelClass.init();

    expect(ipcMain.handle).not.toHaveBeenCalledWith('save-panorama-screenshot', expect.any(Function));
  });

  test('exports the authorized cached file, including symlinks and derived files', async () => {
    const original = path.join(tempDir, 'photo.insp');
    const big = path.join(mainModelClass.static_dir, 'big');
    const destination = path.join(tempDir, 'export.insp');
    fs.writeFileSync(original, 'original');
    fs.symlinkSync(original, path.join(big, 'linked.insp'));
    mainModelClass.authorizedMedia.set(original, 'image');
    mainModelClass.recordExportMedia(original, 'linked.insp');
    dialog.showSaveDialog.mockResolvedValue({ canceled: false, filePath: destination });
    await expect(mainModelClass.saveCurrentMedia({ origPath: original })).resolves.toEqual({ success: true });
    expect(fs.readFileSync(destination, 'utf8')).toBe('original');
    expect(dialog.showSaveDialog).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ defaultPath: 'photo.insp' })
    );
    fs.writeFileSync(path.join(big, 'derived.jpg'), 'derived');
    mainModelClass.recordExportMedia(original, 'derived.jpg');
    const derivedDestination = path.join(tempDir, 'export.jpg');
    dialog.showSaveDialog.mockResolvedValue({ canceled: false, filePath: derivedDestination });
    await expect(mainModelClass.saveCurrentMedia({ origPath: original })).resolves.toEqual({ success: true });
    expect(fs.readFileSync(derivedDestination, 'utf8')).toBe('derived');
    expect(dialog.showSaveDialog).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ defaultPath: 'photo.jpg' })
    );
  });

  test('rejects unsafe and stale exports, source overwrite and concurrent dialogs', async () => {
    const original = path.join(tempDir, 'photo.jpg');
    const big = path.join(mainModelClass.static_dir, 'big');
    fs.writeFileSync(original, 'original');
    fs.symlinkSync(original, path.join(big, 'linked.jpg'));
    mainModelClass.authorizedMedia.set(original, 'image');
    expect(() => mainModelClass.recordExportMedia(original, '../photo.jpg')).toThrow();
    mainModelClass.recordExportMedia(original, 'linked.jpg');
    dialog.showSaveDialog.mockResolvedValue({ canceled: false, filePath: original });
    expect((await mainModelClass.saveCurrentMedia({ origPath: original })).success).toBe(false);
    expect(fs.readFileSync(original, 'utf8')).toBe('original');
    let resolveDialog;
    dialog.showSaveDialog.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveDialog = resolve;
        })
    );
    const first = mainModelClass.saveCurrentMedia({ origPath: original });
    expect((await mainModelClass.saveCurrentMedia({ origPath: original })).success).toBe(false);
    mainModelClass.authorizedMedia.delete(original);
    resolveDialog({ canceled: false, filePath: path.join(tempDir, 'copy.jpg') });
    expect((await first).success).toBe(false);
    expect(fs.existsSync(path.join(tempDir, 'copy.jpg'))).toBe(false);
    expect((await mainModelClass.saveCurrentMedia({ origPath: '/unknown' })).success).toBe(false);
  });

  test('rejects a replaced cache link and invalidates exports on cache clearing', async () => {
    const original = path.join(tempDir, 'photo.jpg');
    const other = path.join(tempDir, 'other.jpg');
    const link = path.join(mainModelClass.static_dir, 'big', 'linked.jpg');
    fs.writeFileSync(original, 'original');
    fs.writeFileSync(other, 'other');
    fs.symlinkSync(original, link);
    mainModelClass.authorizedMedia.set(original, 'image');
    mainModelClass.recordExportMedia(original, 'linked.jpg');
    fs.unlinkSync(link);
    fs.symlinkSync(other, link);
    expect((await mainModelClass.saveCurrentMedia({ origPath: original })).success).toBe(false);
    mainModelClass.deleteCache({ reply: jest.fn() }, []);
    expect(mainModelClass.authorizedMedia.has(original)).toBe(false);
    expect(mainModelClass.exportMedia.has(original)).toBe(false);
  });

  test('updates trusted export after conversion and invalidates it on a new library', async () => {
    const original = path.join(tempDir, 'video.mp4');
    const big = path.join(mainModelClass.static_dir, 'big');
    const output = path.join(tempDir, 'saved.mp4');
    fs.writeFileSync(original, 'original video');
    fs.symlinkSync(original, path.join(big, 'raw.mp4'));
    fs.writeFileSync(path.join(big, 'converted.mp4'), 'converted video');
    mainModelClass.authorizedMedia.set(original, 'video');
    mainModelClass.recordExportMedia(original, 'raw.mp4');
    jest.spyOn(Media, 'convertVideoFor360').mockResolvedValue({ origPath: original, bigName: 'converted.mp4' });
    jest.spyOn(mainModelClass, 'startFileServer').mockImplementation(() => {});
    mainModelClass.init();
    const convert = ipcMain.on.mock.calls.filter(([channel]) => channel === 'convert-video').pop()[1];
    await convert({ reply: jest.fn() }, { filePath: original });
    dialog.showSaveDialog.mockResolvedValue({ canceled: false, filePath: output });
    await expect(mainModelClass.saveCurrentMedia({ origPath: original })).resolves.toEqual({ success: true });
    expect(fs.readFileSync(output, 'utf8')).toBe('converted video');
    mainModelClass.readDir(path.join(tempDir, 'new-library'));
    expect((await mainModelClass.saveCurrentMedia({ origPath: original })).success).toBe(false);
  });

  test('cancels without copying and returns a controlled copy error', async () => {
    const original = path.join(tempDir, 'photo.jpg');
    const link = path.join(mainModelClass.static_dir, 'big', 'linked.jpg');
    fs.writeFileSync(original, 'original');
    fs.symlinkSync(original, link);
    mainModelClass.authorizedMedia.set(original, 'image');
    mainModelClass.recordExportMedia(original, 'linked.jpg');
    dialog.showSaveDialog.mockResolvedValueOnce({ canceled: true });
    await expect(mainModelClass.saveCurrentMedia({ origPath: original })).resolves.toEqual({ cancelled: true });
    dialog.showSaveDialog.mockResolvedValueOnce({
      canceled: false,
      filePath: path.join(tempDir, 'missing', 'copy.jpg'),
    });
    expect((await mainModelClass.saveCurrentMedia({ origPath: original })).success).toBe(false);
  });

  test('rejects source changes while the save dialog is open and invalidates deleted media', async () => {
    const original = path.join(tempDir, 'photo.jpg');
    const link = path.join(mainModelClass.static_dir, 'big', 'linked.jpg');
    const output = path.join(tempDir, 'copy.jpg');
    fs.writeFileSync(original, 'original');
    fs.symlinkSync(original, link);
    mainModelClass.authorizedMedia.set(original, 'image');
    mainModelClass.recordExportMedia(original, 'linked.jpg');
    let resolveDialog;
    dialog.showSaveDialog.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveDialog = resolve;
        })
    );
    const save = mainModelClass.saveCurrentMedia({ origPath: original });
    fs.writeFileSync(original, 'changed content');
    resolveDialog({ canceled: false, filePath: output });
    expect((await save).success).toBe(false);
    expect(fs.existsSync(output)).toBe(false);
    mainModelClass.deleteSelected([{ origPath: original, bigName: 'linked.jpg', thumpName: 'missing.jpg' }]);
    expect((await mainModelClass.saveCurrentMedia({ origPath: original })).success).toBe(false);
  });
});
