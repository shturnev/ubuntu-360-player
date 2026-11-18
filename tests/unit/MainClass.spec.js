const fs = require('fs');
const os = require('os');
const path = require('path');
const { Writable } = require('stream');

jest.mock('electron', () => ({
  dialog: { showOpenDialogSync: jest.fn(), showOpenDialog: jest.fn(), showSaveDialog: jest.fn() },
  ipcMain: { on: jest.fn(), handle: jest.fn() },
  shell: { trashItem: jest.fn(async () => {}) },
}));

jest.mock('electron-updater', () => ({
  autoUpdater: {
    on: jest.fn(),
  },
}));

const { dialog, ipcMain, shell } = require('electron');

jest.mock('trash', () => jest.fn(async () => true));
jest.mock('../../src/models/renameNoReplace', () => jest.fn(jest.requireActual('../../src/models/renameNoReplace')));
jest.mock('../../src/models/insvCache', () => ({ createInsvThumbnail: jest.fn() }));
jest.mock('../../src/models/insvMotion', () => ({
  ...jest.requireActual('../../src/models/insvMotion'),
  prepareInsvMotion: jest.fn(),
}));

const { MainModelClass, removeFilesHelper } = require('../../src/models/MainModelClass');
const { Media } = require('../../src/models/Media');
const { createInsvThumbnail } = require('../../src/models/insvCache');
const { prepareInsvMotion } = require('../../src/models/insvMotion');
const renameNoReplace = require('../../src/models/renameNoReplace');

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
    prepareInsvMotion.mockResolvedValue({
      mode: 'gyro',
      frames: [{ time: 0, rotation: [0, 1, 0, 0] }],
      warning: '',
    });
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    jest.restoreAllMocks();
  });

  test('deleteSelected moves the original to the trash and clears its cache files', async () => {
    const targetDir = mainModelClass.static_dir;
    const thumpFile = path.join(targetDir, 'small', 'thumb.png');
    const bigFile = path.join(targetDir, 'big', 'big.png');
    const originalFile = path.join(tempDir, 'original.png');

    fs.writeFileSync(thumpFile, 'thumb');
    fs.writeFileSync(bigFile, 'big');
    fs.writeFileSync(originalFile, 'image');
    mainModelClass.authorizedMedia.set(originalFile, 'image');
    shell.trashItem.mockImplementationOnce(async (target) => fs.unlinkSync(target));
    const send = jest.fn();
    mainModelClass.win = { webContents: { send } };

    const payload = [
      {
        thumpName: 'thumb.png',
        bigName: 'big.png',
        origPath: originalFile,
        selected: true,
        type: 'image',
      },
    ];

    const result = await mainModelClass.deleteSelected(payload);
    expect(result).toBe(true);
    expect(shell.trashItem).toHaveBeenCalledWith(originalFile);
    expect(fs.existsSync(thumpFile)).toBe(false);
    expect(fs.existsSync(bigFile)).toBe(false);
    expect(fs.existsSync(originalFile)).toBe(false);
    expect(mainModelClass.authorizedMedia.has(originalFile)).toBe(false);
    expect(send).toHaveBeenCalledWith('file-deleted', payload[0]);
  });

  test('deleteSelected keeps the item and cache when the original cannot be trashed', async () => {
    const thumpFile = path.join(mainModelClass.static_dir, 'small', 'thumb.png');
    const originalFile = path.join(tempDir, 'original.png');
    fs.writeFileSync(thumpFile, 'thumb');
    fs.writeFileSync(originalFile, 'image');
    mainModelClass.authorizedMedia.set(originalFile, 'image');
    shell.trashItem.mockClear();
    shell.trashItem.mockRejectedValue(new Error('Trash unavailable'));
    const send = jest.fn();
    mainModelClass.win = { webContents: { send } };

    await mainModelClass.deleteSelected([{ thumpName: 'thumb.png', bigName: 'big.png', origPath: originalFile }]);
    expect(shell.trashItem).toHaveBeenCalledTimes(3);
    shell.trashItem.mockReset().mockImplementation(async () => {});

    expect(fs.existsSync(originalFile)).toBe(true);
    expect(fs.existsSync(thumpFile)).toBe(true);
    expect(mainModelClass.authorizedMedia.has(originalFile)).toBe(true);
    expect(send).toHaveBeenCalledWith(
      'delete-error',
      expect.objectContaining({ message: expect.stringContaining('Trash unavailable') })
    );
    expect(send).not.toHaveBeenCalledWith('file-deleted', expect.anything());
  });

  test('deleteSelected refuses files that were not imported', async () => {
    const send = jest.fn();
    mainModelClass.win = { webContents: { send } };
    shell.trashItem.mockClear();

    await mainModelClass.deleteSelected([
      { thumpName: 't.png', bigName: 'b.png', origPath: path.join(tempDir, 'x.png') },
    ]);

    expect(shell.trashItem).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledWith('delete-error', expect.objectContaining({ message: expect.any(String) }));
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

  test('imports a complete INSV pair as one item and rejects an incomplete pair', async () => {
    const sourceDir = path.join(tempDir, 'insv');
    fs.mkdirSync(sourceDir);
    const names = [
      'VID_20250125_151712_00_105.insv',
      'VID_20250125_151712_10_105.INSV',
      'VID_20250125_151800_00_106.insv',
    ];
    names.forEach((name) => fs.writeFileSync(path.join(sourceDir, name), 'original'));
    const saveVideo = jest.spyOn(Media, 'saveVideo');
    jest.spyOn(Media, 'probeVideo').mockResolvedValue({
      streams: [
        {
          codec_type: 'video',
          codec_name: 'h264',
          width: 2880,
          height: 2880,
          r_frame_rate: '30000/1001',
          start_time: '0',
          duration: '34.6346',
        },
      ],
    });
    const verifyVideo = jest.spyOn(Media, 'verifyInsvVideo').mockResolvedValue(0.001);
    createInsvThumbnail.mockResolvedValue('pair.jpg');
    const send = mainModelClass.win.webContents.send;

    await mainModelClass.readDir(sourceDir);

    expect(send).toHaveBeenCalledWith('start-read-dir', 2);
    const results = send.mock.calls.filter(([channel]) => channel === 'read-media-file').map(([, result]) => result);
    expect(results).toHaveLength(2);
    const item = results.find((result) => result.insv);
    expect(item).toMatchObject({ type: 'video', origPath: path.join(sourceDir, names[0]), thumpName: 'pair.jpg' });
    expect(results.find((result) => result.error).error.message).toMatch(/Incomplete INSV pair/);
    expect(saveVideo).not.toHaveBeenCalled();
    expect(verifyVideo).toHaveBeenCalledTimes(2);
    expect(mainModelClass.authorizedMedia.get(item.origPath)).toBe('insv');
    expect(mainModelClass.exportMedia.has(item.origPath)).toBe(false);
    expect(mainModelClass.insvSources.records.has(item.insvToken)).toBe(true);
    expect(item.frameRate).toBeCloseTo(30000 / 1001);
    expect(item.motionMode).toBe('gyro');
    expect(mainModelClass.insvSources.horizonTracks.get(item.insvToken)).toEqual([{ time: 0, rotation: [0, 1, 0, 0] }]);
    expect(createInsvThumbnail).toHaveBeenLastCalledWith(expect.anything(), expect.any(String), [0, 1, 0, 0]);
    expect(send).toHaveBeenCalledWith('insv-progress', { active: true, name: names[0], stage: 'checking' });
    expect(send).toHaveBeenCalledWith('insv-progress', { active: true, name: names[0], stage: 'stabilizing' });
    expect(send).toHaveBeenCalledWith('insv-progress', { active: false });
    names.forEach((name) => expect(fs.readFileSync(path.join(sourceDir, name), 'utf8')).toBe('original'));

    mainModelClass.deleteSelected([item]);
    expect(send).toHaveBeenCalledWith(
      'delete-error',
      expect.objectContaining({ message: expect.stringContaining('INSV') })
    );
    expect(mainModelClass.insvSources.records.has(item.insvToken)).toBe(true);
    mainModelClass.removeFromLibrary([item]);
    expect(mainModelClass.insvSources.records.has(item.insvToken)).toBe(false);

    send.mockClear();
    await mainModelClass.readFiles([path.join(sourceDir, names[0])]);
    expect(send).toHaveBeenCalledWith(
      'read-media-file',
      expect.objectContaining({ error: expect.objectContaining({ message: expect.stringContaining('Incomplete') }) })
    );
    expect(mainModelClass.authorizedMedia.size).toBe(0);
  });

  test('reports thumbnail failure without authorizing or importing an INSV pair', async () => {
    const sourceDir = path.join(tempDir, 'failed-insv');
    fs.mkdirSync(sourceDir);
    const names = ['VID_20250125_151712_00_105.insv', 'VID_20250125_151712_10_105.insv'];
    names.forEach((name) => fs.writeFileSync(path.join(sourceDir, name), 'original'));
    jest.spyOn(Media, 'probeVideo').mockResolvedValue({
      streams: [
        {
          codec_type: 'video',
          codec_name: 'h264',
          width: 2880,
          height: 2880,
          r_frame_rate: '30000/1001',
          start_time: '0',
          duration: '34.6346',
        },
      ],
    });

    jest.spyOn(Media, 'verifyInsvVideo').mockResolvedValue(0.001);
    createInsvThumbnail.mockRejectedValueOnce(new Error('Thumbnail failed.'));

    await mainModelClass.readDir(sourceDir);

    expect(mainModelClass.win.webContents.send).toHaveBeenCalledWith(
      'read-media-file',
      expect.objectContaining({ error: expect.objectContaining({ message: 'Thumbnail failed.' }) })
    );
    expect(mainModelClass.authorizedMedia.size).toBe(0);
    expect(mainModelClass.insvSources.records.size).toBe(0);
    names.forEach((name) => expect(fs.readFileSync(path.join(sourceDir, name), 'utf8')).toBe('original'));
  });

  test('reuses stabilization on repeated directory imports', async () => {
    const sourceDir = path.join(tempDir, 'repeat-insv');
    fs.mkdirSync(sourceDir);
    ['VID_20250125_151712_00_105.insv', 'VID_20250125_151712_10_105.insv'].forEach((name) =>
      fs.writeFileSync(path.join(sourceDir, name), 'original')
    );
    jest.spyOn(Media, 'probeVideo').mockResolvedValue({
      streams: [
        {
          codec_type: 'video',
          codec_name: 'h264',
          width: 2880,
          height: 2880,
          r_frame_rate: '30000/1001',
          start_time: '0',
          duration: '34.6346',
        },
      ],
    });
    jest.spyOn(Media, 'verifyInsvVideo').mockResolvedValue(0.001);
    createInsvThumbnail.mockResolvedValue('pair.jpg');
    prepareInsvMotion.mockClear();
    const send = mainModelClass.win.webContents.send;
    await mainModelClass.readDir(sourceDir);
    send.mockClear();
    await mainModelClass.readDir(sourceDir);
    expect(prepareInsvMotion).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith('insv-progress', expect.objectContaining({ stage: 'checking', active: true }));
    expect(send).not.toHaveBeenCalledWith('insv-progress', expect.objectContaining({ stage: 'stabilizing' }));
    expect(send).toHaveBeenCalledWith('read-media-file', expect.objectContaining({ insv: true, motionMode: 'gyro' }));
  });

  test('does not authorize an INSV pair changed while motion is being prepared', async () => {
    const sourceDir = path.join(tempDir, 'changed-insv');
    fs.mkdirSync(sourceDir);
    const files = ['VID_20250125_151712_00_105.insv', 'VID_20250125_151712_10_105.insv'].map((name) =>
      path.join(sourceDir, name)
    );
    files.forEach((file) => fs.writeFileSync(file, 'original'));
    jest.spyOn(Media, 'probeVideo').mockResolvedValue({
      streams: [
        {
          codec_type: 'video',
          codec_name: 'h264',
          width: 2880,
          height: 2880,
          r_frame_rate: '30000/1001',
          start_time: '0',
          duration: '34.6346',
        },
      ],
    });
    jest.spyOn(Media, 'verifyInsvVideo').mockResolvedValue(0.001);
    prepareInsvMotion.mockImplementationOnce(async () => {
      fs.appendFileSync(files[1], 'changed');
      return { mode: 'gyro', frames: [{ time: 0, rotation: [0, 0, 0, 1] }], warning: '' };
    });
    createInsvThumbnail.mockResolvedValue('pair.jpg');

    await mainModelClass.readDir(sourceDir);
    expect(mainModelClass.win.webContents.send).toHaveBeenCalledWith(
      'read-media-file',
      expect.objectContaining({ error: expect.objectContaining({ message: expect.stringMatching(/changed/) }) })
    );
    expect(mainModelClass.insvSources.records.size).toBe(0);
    expect(mainModelClass.authorizedMedia.size).toBe(0);
  });

  test('does not send stale progress or results after changing directories during INSV preparation', async () => {
    const sourceDir = path.join(tempDir, 'old-insv');
    const newDir = path.join(tempDir, 'new-library');
    fs.mkdirSync(sourceDir);
    fs.mkdirSync(newDir);
    ['VID_20250125_151712_00_105.insv', 'VID_20250125_151712_10_105.insv'].forEach((name) =>
      fs.writeFileSync(path.join(sourceDir, name), 'original')
    );
    jest.spyOn(Media, 'probeVideo').mockResolvedValue({
      streams: [
        {
          codec_type: 'video',
          codec_name: 'h264',
          width: 2880,
          height: 2880,
          r_frame_rate: '30000/1001',
          start_time: '0',
          duration: '34.6346',
        },
      ],
    });
    jest.spyOn(Media, 'verifyInsvVideo').mockResolvedValue(0.001);
    let finish;
    let notifyStarted;
    const started = new Promise((resolve) => {
      notifyStarted = resolve;
    });
    prepareInsvMotion.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
          notifyStarted();
        })
    );
    const oldImport = mainModelClass.readDir(sourceDir);
    await started;
    await mainModelClass.readDir(newDir);
    mainModelClass.win.webContents.send.mockClear();
    finish({ mode: 'none', frames: [], warning: 'Unavailable.' });
    await oldImport;
    expect(mainModelClass.win.webContents.send).not.toHaveBeenCalledWith('insv-progress', expect.anything());
    expect(mainModelClass.win.webContents.send).not.toHaveBeenCalledWith('read-media-file', expect.anything());
    expect(mainModelClass.insvSources.records.size).toBe(0);
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
    const motionDir = path.join(mainModelClass.homedir, 'insv-motion');
    fs.mkdirSync(motionDir);
    fs.writeFileSync(path.join(motionDir, 'track.json'), 'cached');

    const event = { reply: jest.fn() };
    mainModelClass.deleteCache(event, []);

    await new Promise((resolve) => setTimeout(resolve, 25));

    expect(fs.existsSync(mainModelClass.static_dir)).toBe(false);
    expect(fs.existsSync(motionDir)).toBe(false);
    expect(event.reply).toHaveBeenCalledWith('delete-cache-finish', true);
  });

  test('partial cache cleanup preserves motion tracks and retained thumbnails', () => {
    const smallDir = path.join(mainModelClass.static_dir, 'small');
    const bigDir = path.join(mainModelClass.static_dir, 'big');
    const motionDir = path.join(mainModelClass.homedir, 'insv-motion');
    fs.mkdirSync(motionDir);
    fs.writeFileSync(path.join(motionDir, 'first.json'), 'first track');
    fs.writeFileSync(path.join(motionDir, 'second.json'), 'second track');
    fs.writeFileSync(path.join(smallDir, 'keep.jpg'), 'keep');
    fs.writeFileSync(path.join(smallDir, 'remove.jpg'), 'remove');
    fs.writeFileSync(path.join(bigDir, 'keep.jpg'), 'keep');
    fs.writeFileSync(path.join(bigDir, 'remove.jpg'), 'remove');

    const event = { reply: jest.fn() };
    mainModelClass.deleteCache(event, [{ thumpName: 'keep.jpg', bigName: 'keep.jpg' }]);

    expect(fs.readdirSync(motionDir).sort()).toEqual(['first.json', 'second.json']);
    expect(fs.readdirSync(smallDir)).toEqual(['keep.jpg']);
    expect(fs.readdirSync(bigDir)).toEqual(['keep.jpg']);
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

  test('file picker is multi-select and cancellation keeps the current authorization', () => {
    mainModelClass.authorizedMedia.set('/existing.jpg', 'image');
    dialog.showOpenDialogSync.mockReturnValueOnce(undefined);
    const event = { reply: jest.fn() };
    expect(mainModelClass.openFiles(event)).toBe(false);
    expect(dialog.showOpenDialogSync).toHaveBeenLastCalledWith({
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Media', extensions: ['jpg', 'jpeg', 'png', 'insp', 'mp4', 'insv'] }],
    });
    expect(event.reply).toHaveBeenCalledWith('add-files', false);
    expect(mainModelClass.authorizedMedia.get('/existing.jpg')).toBe('image');
    expect(mainModelClass.importBusy).toBe(false);
  });

  test('rejects concurrent manual dialogs while an external import is active', () => {
    mainModelClass.importBusy = true;
    const event = { reply: jest.fn() };
    dialog.showOpenDialogSync.mockClear();
    expect(mainModelClass.openDir(event)).toBe(false);
    expect(mainModelClass.openFiles(event)).toBe(false);
    expect(dialog.showOpenDialogSync).not.toHaveBeenCalled();
  });

  test('routes every supported uppercase format and reports a partial preparation failure', async () => {
    const paths = ['a.JPG', 'b.JPEG', 'c.PNG', 'd.INSP', 'e.MP4'].map((name) => path.join(tempDir, name));
    paths.forEach((file) => fs.writeFileSync(file, 'data'));
    const saveImage = jest
      .spyOn(Media, 'saveImage')
      .mockImplementation((file, _win, cb) =>
        cb(file === paths[1] ? { origPath: file, error: { message: 'Thumbnail failed' } } : { origPath: file })
      );
    const saveInsta = jest
      .spyOn(Media, 'saveInsta360Image')
      .mockImplementation((file, _win, cb) => cb({ origPath: file }));
    const saveVideo = jest.spyOn(Media, 'saveVideo').mockImplementation((file, _win, cb) => cb({ origPath: file }));
    await mainModelClass.readFiles(paths);
    expect(saveImage).toHaveBeenCalledTimes(3);
    expect(saveInsta).toHaveBeenCalledTimes(1);
    expect(saveVideo).toHaveBeenCalledTimes(1);
    expect(mainModelClass.authorizedMedia.has(paths[1])).toBe(false);
    expect(mainModelClass.authorizedMedia.has(paths[0])).toBe(true);
    expect(
      mainModelClass.win.webContents.send.mock.calls.filter(([channel]) => channel === 'read-media-file')
    ).toHaveLength(5);
  });
  test('appends canonical files once, reports invalid paths and waits for every callback', async () => {
    const first = path.join(tempDir, 'same.JPG');
    const otherDir = path.join(tempDir, 'other');
    fs.mkdirSync(otherDir);
    const second = path.join(otherDir, 'same.JPG');
    const alias = path.join(tempDir, 'alias.jpg');
    fs.writeFileSync(first, 'first');
    fs.writeFileSync(second, 'second');
    fs.symlinkSync(first, alias);
    const callbacks = new Map();
    jest.spyOn(Media, 'saveImage').mockImplementation((file, _win, cb) => callbacks.set(file, cb));
    const send = mainModelClass.win.webContents.send;
    mainModelClass.authorizedMedia.set('/old.jpg', 'image');
    const oldExport = {};
    mainModelClass.exportMedia.set('/old.jpg', oldExport);
    let finished = false;
    const promise = mainModelClass
      .readFiles([first, alias, second, path.join(tempDir, 'missing.png'), tempDir])
      .then(() => {
        finished = true;
      });
    expect(send).toHaveBeenCalledWith('start-read-files', 4);
    expect(callbacks.size).toBe(2);
    callbacks.get(first)({ origPath: first });
    await Promise.resolve();
    expect(finished).toBe(false);
    callbacks.get(second)({ origPath: second });
    await promise;
    expect(mainModelClass.authorizedMedia.get('/old.jpg')).toBe('image');
    expect(mainModelClass.exportMedia.get('/old.jpg')).toBe(oldExport);
    expect(send.mock.calls.filter(([channel]) => channel === 'read-media-file')).toHaveLength(4);
    expect(send).toHaveBeenLastCalledWith('import-finished');
    send.mockClear();
    await mainModelClass.readFiles([alias, first]);
    expect(send).toHaveBeenCalledWith('start-read-files', 0);
    expect(send.mock.calls.filter(([channel]) => channel === 'read-media-file')).toHaveLength(0);
  });

  test('queues external files until the active batch callback completes', async () => {
    const first = path.join(tempDir, 'a.jpg');
    const second = path.join(tempDir, 'b.insp');
    fs.writeFileSync(first, 'image');
    fs.writeFileSync(second, 'image');
    let firstCallback;
    let secondCallback;
    jest.spyOn(Media, 'saveImage').mockImplementation((_file, _win, cb) => {
      firstCallback = cb;
    });
    jest.spyOn(Media, 'saveInsta360Image').mockImplementation((_file, _win, cb) => {
      secondCallback = cb;
    });
    mainModelClass.enqueueExternalImport({ files: [first] });
    mainModelClass.enqueueExternalImport({ files: [second] });
    expect(firstCallback).toEqual(expect.any(Function));
    expect(secondCallback).toBeUndefined();
    firstCallback({ origPath: first });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(secondCallback).toEqual(expect.any(Function));
    secondCallback({ origPath: second });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mainModelClass.importBusy).toBe(false);
  });

  test('holds queued external imports until the replacement renderer is ready', async () => {
    const file = path.join(tempDir, 'pending.jpg');
    fs.writeFileSync(file, 'image');
    const save = jest.spyOn(Media, 'saveImage').mockImplementation((origPath, _win, cb) => cb({ origPath }));
    mainModelClass.setExternalImportReady(false);
    mainModelClass.enqueueExternalImport({ files: [file] });
    expect(save).not.toHaveBeenCalled();
    mainModelClass.setExternalImportReady(true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(save).toHaveBeenCalledTimes(1);
  });

  test('waits for derived image EXIF synchronization before importing the next batch', async () => {
    const first = path.join(tempDir, 'a.insp');
    const second = path.join(tempDir, 'b.jpg');
    fs.writeFileSync(first, 'image');
    fs.writeFileSync(second, 'image');
    fs.writeFileSync(path.join(mainModelClass.static_dir, 'big', 'derived.jpg'), 'derived');
    let finishExif;
    jest.spyOn(Media, 'syncCachedExif').mockImplementation(
      () =>
        new Promise((resolve) => {
          finishExif = resolve;
        })
    );
    jest
      .spyOn(Media, 'saveInsta360Image')
      .mockImplementation((_file, _win, cb) => cb({ origPath: first, bigName: 'derived.jpg' }));
    const saveImage = jest.spyOn(Media, 'saveImage').mockImplementation((_file, _win, cb) => cb({ origPath: second }));
    mainModelClass.enqueueExternalImport({ files: [first] });
    mainModelClass.enqueueExternalImport({ files: [second] });
    expect(saveImage).not.toHaveBeenCalled();
    finishExif();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(saveImage).toHaveBeenCalledTimes(1);
  });

  test('does not resurrect a removed file when its preparation completes', async () => {
    const file = path.join(tempDir, 'removed.jpg');
    fs.writeFileSync(file, 'image');
    let callback;
    jest.spyOn(Media, 'saveImage').mockImplementation((_file, _win, cb) => {
      callback = cb;
    });
    const promise = mainModelClass.readFiles([file]);
    mainModelClass.removeFromLibrary([{ origPath: file }]);
    callback({ origPath: file, bigName: 'removed.jpg' });
    await promise;
    expect(mainModelClass.authorizedMedia.has(file)).toBe(false);
    expect(mainModelClass.win.webContents.send).toHaveBeenCalledWith(
      'read-media-file',
      expect.objectContaining({ origPath: file, error: expect.any(Object) })
    );
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

  test('reads metadata only from an authorized, unchanged INSV pair', async () => {
    const files = [path.join(tempDir, '00.insv'), path.join(tempDir, '10.insv')];
    files.forEach((file) => fs.writeFileSync(file, 'original'));
    const pair = {
      paths: files,
      snapshots: files.map((file) => {
        const { dev, ino, size, mtimeMs, ctimeMs } = fs.statSync(file);
        return { dev, ino, size, mtimeMs, ctimeMs };
      }),
    };
    const token = mainModelClass.insvSources.register(pair);
    mainModelClass.insvTokens.set(files[0], token);
    mainModelClass.authorizedMedia.set(files[0], 'insv');
    const metadata = jest
      .spyOn(Media, 'getInsvMetadata')
      .mockResolvedValue([{ key: 'model', label: 'Model', value: 'X' }]);
    jest.spyOn(mainModelClass, 'startFileServer').mockImplementation(() => {});
    mainModelClass.init();
    const handler = ipcMain.on.mock.calls.filter(([channel]) => channel === 'get-media-metadata').pop()[1];
    const event = { reply: jest.fn() };
    await handler(event, { origPath: files[0], type: 'video', requestId: 1 });
    expect(metadata).toHaveBeenCalledWith(pair);
    expect(event.reply).toHaveBeenCalledWith('media-metadata', {
      origPath: files[0],
      requestId: 1,
      entries: [{ key: 'model', label: 'Model', value: 'X' }],
    });

    fs.appendFileSync(files[1], 'changed');
    await handler(event, { origPath: files[0], type: 'video', requestId: 2 });
    expect(metadata).toHaveBeenCalledTimes(1);
    expect(event.reply).toHaveBeenLastCalledWith(
      'media-metadata',
      expect.objectContaining({ requestId: 2, error: expect.stringMatching(/changed/) })
    );
    await handler(event, { origPath: files[1], type: 'video', requestId: 3 });
    expect(event.reply).toHaveBeenLastCalledWith(
      'media-metadata',
      expect.objectContaining({ requestId: 3, error: expect.stringMatching(/not available/) })
    );
  });

  test('does not return INSV metadata if the pair changes or is revoked while reading', async () => {
    const files = [path.join(tempDir, '00.insv'), path.join(tempDir, '10.insv')];
    files.forEach((file) => fs.writeFileSync(file, 'original'));
    const pair = {
      paths: files,
      snapshots: files.map((file) => {
        const { dev, ino, size, mtimeMs, ctimeMs } = fs.statSync(file);
        return { dev, ino, size, mtimeMs, ctimeMs };
      }),
    };
    const token = mainModelClass.insvSources.register(pair);
    mainModelClass.insvTokens.set(files[0], token);
    mainModelClass.authorizedMedia.set(files[0], 'insv');
    jest.spyOn(Media, 'getInsvMetadata').mockImplementation(async () => {
      mainModelClass.insvSources.revoke(token);
      return [{ key: 'model', label: 'Model', value: 'X' }];
    });
    jest.spyOn(mainModelClass, 'startFileServer').mockImplementation(() => {});
    mainModelClass.init();
    const handler = ipcMain.on.mock.calls.filter(([channel]) => channel === 'get-media-metadata').pop()[1];
    const event = { reply: jest.fn() };
    await handler(event, { origPath: files[0], type: 'video', requestId: 1 });
    expect(event.reply).toHaveBeenCalledWith(
      'media-metadata',
      expect.objectContaining({ requestId: 1, error: expect.stringMatching(/no longer available/) })
    );
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

  test('atomically replaces an existing export and retains its permissions', async () => {
    const original = path.join(tempDir, 'photo.jpg');
    const destination = path.join(tempDir, 'export.jpg');
    fs.writeFileSync(original, 'new image');
    fs.writeFileSync(destination, 'old image');
    fs.chmodSync(destination, 0o640);
    fs.symlinkSync(original, path.join(mainModelClass.static_dir, 'big', 'linked.jpg'));
    mainModelClass.authorizedMedia.set(original, 'image');
    mainModelClass.recordExportMedia(original, 'linked.jpg');
    dialog.showSaveDialog.mockResolvedValue({ canceled: false, filePath: destination });

    await expect(mainModelClass.saveCurrentMedia({ origPath: original })).resolves.toEqual({ success: true });
    expect(fs.readFileSync(destination, 'utf8')).toBe('new image');
    expect(fs.statSync(destination).mode & 0o777).toBe(0o640);
    expect(fs.readdirSync(tempDir).filter((name) => name.startsWith('.sht-vr-export-'))).toEqual([]);
  });

  test('keeps an existing destination intact and removes the temporary file when writing fails', async () => {
    const original = path.join(tempDir, 'photo.jpg');
    const destination = path.join(tempDir, 'export.jpg');
    fs.writeFileSync(original, 'new image');
    fs.writeFileSync(destination, 'old image');
    fs.symlinkSync(original, path.join(mainModelClass.static_dir, 'big', 'linked.jpg'));
    mainModelClass.authorizedMedia.set(original, 'image');
    mainModelClass.recordExportMedia(original, 'linked.jpg');
    dialog.showSaveDialog.mockResolvedValue({ canceled: false, filePath: destination });
    const open = fs.promises.open.bind(fs.promises);
    jest.spyOn(fs.promises, 'open').mockImplementation(async (filePath, ...args) => {
      const handle = await open(filePath, ...args);
      if (path.basename(filePath).startsWith('.sht-vr-export-')) {
        jest.spyOn(handle, 'createWriteStream').mockImplementation(
          () =>
            new Writable({
              write(chunk, _encoding, callback) {
                handle.write(chunk.subarray(0, 3)).then(() => callback(new Error('Disk full')), callback);
              },
            })
        );
      }
      return handle;
    });

    await expect(mainModelClass.saveCurrentMedia({ origPath: original })).resolves.toEqual({
      success: false,
      message: 'Disk full',
    });
    expect(fs.readFileSync(destination, 'utf8')).toBe('old image');
    expect(fs.readdirSync(tempDir).filter((name) => name.startsWith('.sht-vr-export-'))).toEqual([]);
  });

  test('rejects symlink and hard-link destinations that refer to the source', async () => {
    const original = path.join(tempDir, 'photo.jpg');
    fs.writeFileSync(original, 'original');
    fs.symlinkSync(original, path.join(mainModelClass.static_dir, 'big', 'linked.jpg'));
    mainModelClass.authorizedMedia.set(original, 'image');
    mainModelClass.recordExportMedia(original, 'linked.jpg');
    const symlink = path.join(tempDir, 'symlink.jpg');
    const hardlink = path.join(tempDir, 'hardlink.jpg');
    fs.symlinkSync(original, symlink);
    fs.linkSync(original, hardlink);
    for (const filePath of [symlink, hardlink]) {
      dialog.showSaveDialog.mockResolvedValue({ canceled: false, filePath });
      expect((await mainModelClass.saveCurrentMedia({ origPath: original })).success).toBe(false);
    }
    expect(fs.readFileSync(original, 'utf8')).toBe('original');
  });

  test('does not replace a destination changed during export', async () => {
    const original = path.join(tempDir, 'photo.jpg');
    const destination = path.join(tempDir, 'export.jpg');
    fs.writeFileSync(original, 'new image');
    fs.writeFileSync(destination, 'old image');
    fs.symlinkSync(original, path.join(mainModelClass.static_dir, 'big', 'linked.jpg'));
    mainModelClass.authorizedMedia.set(original, 'image');
    mainModelClass.recordExportMedia(original, 'linked.jpg');
    dialog.showSaveDialog.mockResolvedValue({ canceled: false, filePath: destination });
    const lstat = fs.promises.lstat.bind(fs.promises);
    let destinationChecks = 0;
    jest.spyOn(fs.promises, 'lstat').mockImplementation(async (filePath, ...args) => {
      if (filePath === destination && ++destinationChecks === 2) fs.writeFileSync(destination, 'changed elsewhere');
      return lstat(filePath, ...args);
    });

    await expect(mainModelClass.saveCurrentMedia({ origPath: original })).resolves.toEqual({
      success: false,
      message: 'The destination file has changed.',
    });
    expect(fs.readFileSync(destination, 'utf8')).toBe('changed elsewhere');
    expect(fs.readdirSync(tempDir).filter((name) => name.startsWith('.sht-vr-export-'))).toEqual([]);
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
    await mainModelClass.deleteSelected([{ origPath: original, bigName: 'linked.jpg', thumpName: 'missing.jpg' }]);
    expect((await mainModelClass.saveCurrentMedia({ origPath: original })).success).toBe(false);
  });

  test('exports cached bytes to unique names without overwriting existing objects', async () => {
    const out = path.join(tempDir, 'out');
    const originals = [path.join(tempDir, 'one', 'photo.insp'), path.join(tempDir, 'two', 'photo.jpg')];
    fs.mkdirSync(out);
    for (const original of originals) {
      fs.mkdirSync(path.dirname(original), { recursive: true });
      fs.writeFileSync(original, 'original');
      mainModelClass.authorizedMedia.set(original, 'image');
    }
    const big = path.join(mainModelClass.static_dir, 'big');
    const derived = Buffer.from([0xff, 0xd8, 0xff, 0xe1, 0x00, 0x0a, 0x45, 0x78, 0x69, 0x66, 0, 0, 0xff, 0xd9]);
    fs.writeFileSync(path.join(big, 'derived.jpg'), derived);
    fs.symlinkSync(originals[1], path.join(big, 'linked.jpg'));
    mainModelClass.recordExportMedia(originals[0], 'derived.jpg');
    mainModelClass.recordExportMedia(originals[1], 'linked.jpg');
    fs.writeFileSync(path.join(out, 'photo.jpg'), 'existing');
    fs.symlinkSync(originals[1], path.join(out, 'photo (1).jpg'));
    dialog.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: [out] });
    const progress = jest.fn();
    await expect(mainModelClass.saveSelectedMedia(originals, progress)).resolves.toEqual({
      success: true,
      saved: 2,
      errors: [],
    });
    expect(progress.mock.calls).toEqual([
      [{ complete: 0, total: 2 }],
      [{ complete: 1, total: 2 }],
      [{ complete: 2, total: 2 }],
    ]);
    expect(dialog.showOpenDialog).toHaveBeenCalledWith(
      mainModelClass.win,
      expect.objectContaining({ properties: ['openDirectory'] })
    );
    expect(fs.readFileSync(path.join(out, 'photo.jpg'), 'utf8')).toBe('existing');
    expect(fs.readFileSync(path.join(out, 'photo (2).jpg'))).toEqual(derived);
    expect(fs.readFileSync(path.join(out, 'photo (3).jpg'), 'utf8')).toBe('original');
    expect(fs.lstatSync(path.join(out, 'photo (1).jpg')).isSymbolicLink()).toBe(true);
    expect(fs.readdirSync(out).filter((name) => name.startsWith('.sht-vr-export-'))).toEqual([]);
  });

  test('rejects invalid batches and cancels without writing', async () => {
    const original = path.join(tempDir, 'photo.jpg');
    fs.writeFileSync(original, 'image');
    fs.symlinkSync(original, path.join(mainModelClass.static_dir, 'big', 'linked.jpg'));
    mainModelClass.authorizedMedia.set(original, 'image');
    mainModelClass.recordExportMedia(original, 'linked.jpg');
    dialog.showOpenDialog.mockClear().mockResolvedValue({ canceled: true, filePaths: [] });
    for (const input of [null, [], [original, original], [original, 1], ['/unknown'], { origPaths: [original] }]) {
      expect((await mainModelClass.saveSelectedMedia(input)).success).toBe(false);
    }
    expect(dialog.showOpenDialog).not.toHaveBeenCalled();
    const progress = jest.fn();
    await expect(mainModelClass.saveSelectedMedia([original], progress)).resolves.toEqual({ cancelled: true });
    expect(progress).not.toHaveBeenCalled();
    expect(dialog.showOpenDialog).toHaveBeenCalledTimes(1);
    expect(fs.readFileSync(original, 'utf8')).toBe('image');
  });

  test('continues after missing or replaced sources and cleans temporary files', async () => {
    const out = path.join(tempDir, 'out');
    fs.mkdirSync(out);
    const originals = ['missing.jpg', 'replaced.jpg', 'good.jpg'].map((name) => path.join(tempDir, name));
    for (const original of originals) {
      fs.writeFileSync(original, original);
      fs.symlinkSync(original, path.join(mainModelClass.static_dir, 'big', path.basename(original)));
      mainModelClass.authorizedMedia.set(original, 'image');
      mainModelClass.recordExportMedia(original, path.basename(original));
    }
    fs.unlinkSync(originals[0]);
    const replacedLink = path.join(mainModelClass.static_dir, 'big', 'replaced.jpg');
    fs.unlinkSync(replacedLink);
    fs.symlinkSync(originals[2], replacedLink);
    dialog.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: [out] });
    const progress = jest.fn();
    const result = await mainModelClass.saveSelectedMedia(originals, progress);
    expect(result.success).toBe(false);
    expect(result.saved).toBe(1);
    expect(result.errors.map((error) => error.origPath)).toEqual(originals.slice(0, 2));
    expect(progress.mock.calls).toEqual([
      [{ complete: 0, total: 3 }],
      [{ complete: 1, total: 3 }],
      [{ complete: 2, total: 3 }],
      [{ complete: 3, total: 3 }],
    ]);
    expect(fs.readdirSync(out)).toEqual(['good.jpg']);
    expect(fs.readFileSync(path.join(out, 'good.jpg'), 'utf8')).toBe(originals[2]);
  });

  test('continues after a partial write failure and removes its temporary file', async () => {
    const out = path.join(tempDir, 'out');
    fs.mkdirSync(out);
    const originals = ['first.jpg', 'second.jpg'].map((name) => path.join(tempDir, name));
    for (const original of originals) {
      fs.writeFileSync(original, 'cached bytes');
      fs.symlinkSync(original, path.join(mainModelClass.static_dir, 'big', path.basename(original)));
      mainModelClass.authorizedMedia.set(original, 'image');
      mainModelClass.recordExportMedia(original, path.basename(original));
    }
    dialog.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: [out] });
    const open = fs.promises.open.bind(fs.promises);
    let failed = false;
    jest.spyOn(fs.promises, 'open').mockImplementation(async (filePath, ...args) => {
      const handle = await open(filePath, ...args);
      if (!failed && path.basename(filePath).startsWith('.sht-vr-export-')) {
        failed = true;
        jest.spyOn(handle, 'createWriteStream').mockImplementation(
          () =>
            new Writable({
              write(chunk, _encoding, callback) {
                handle.write(chunk.subarray(0, 3)).then(() => callback(new Error('Disk full')), callback);
              },
            })
        );
      }
      return handle;
    });
    await expect(mainModelClass.saveSelectedMedia(originals)).resolves.toEqual({
      success: false,
      saved: 1,
      errors: [{ origPath: originals[0], message: 'Disk full' }],
    });
    expect(fs.readdirSync(out)).toEqual(['second.jpg']);
    expect(fs.readFileSync(path.join(out, 'second.jpg'), 'utf8')).toBe('cached bytes');
  });

  test('does not export an item removed from the library while the directory dialog is open', async () => {
    const original = path.join(tempDir, 'photo.jpg');
    const out = path.join(tempDir, 'out');
    fs.mkdirSync(out);
    fs.writeFileSync(original, 'image');
    fs.symlinkSync(original, path.join(mainModelClass.static_dir, 'big', 'linked.jpg'));
    mainModelClass.authorizedMedia.set(original, 'image');
    mainModelClass.recordExportMedia(original, 'linked.jpg');
    let resolveDialog;
    dialog.showOpenDialog.mockImplementation(() => new Promise((resolve) => (resolveDialog = resolve)));
    const batch = mainModelClass.saveSelectedMedia([original]);
    mainModelClass.authorizedMedia.delete(original);
    resolveDialog({ canceled: false, filePaths: [out] });
    const result = await batch;
    expect(result.saved).toBe(0);
    expect(result.errors[0].origPath).toBe(original);
    expect(fs.readdirSync(out)).toEqual([]);
  });

  test('rejects source changes during copying and removes the incomplete export', async () => {
    const original = path.join(tempDir, 'photo.jpg');
    const out = path.join(tempDir, 'out');
    fs.mkdirSync(out);
    fs.writeFileSync(original, 'original');
    fs.symlinkSync(original, path.join(mainModelClass.static_dir, 'big', 'linked.jpg'));
    mainModelClass.authorizedMedia.set(original, 'image');
    mainModelClass.recordExportMedia(original, 'linked.jpg');
    dialog.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: [out] });
    const open = fs.promises.open.bind(fs.promises);
    jest.spyOn(fs.promises, 'open').mockImplementation(async (filePath, ...args) => {
      const handle = await open(filePath, ...args);
      if (path.basename(filePath).startsWith('.sht-vr-export-')) {
        jest.spyOn(handle, 'createWriteStream').mockImplementation(
          () =>
            new Writable({
              write(chunk, _encoding, callback) {
                handle.write(chunk).then(() => {
                  fs.writeFileSync(original, 'modified while copying');
                  callback();
                }, callback);
              },
            })
        );
      }
      return handle;
    });
    const result = await mainModelClass.saveSelectedMedia([original]);
    expect(result.success).toBe(false);
    expect(result.saved).toBe(0);
    expect(result.errors[0]).toEqual({ origPath: original, message: 'The cached media file has changed.' });
    expect(fs.readdirSync(out)).toEqual([]);
  });

  test('handles a destination race atomically, including names without extensions', async () => {
    const out = path.join(tempDir, 'out');
    const original = path.join(tempDir, 'photo.jpg');
    fs.mkdirSync(out);
    fs.writeFileSync(original, 'original');
    fs.writeFileSync(path.join(mainModelClass.static_dir, 'big', 'derived'), 'cached');
    mainModelClass.authorizedMedia.set(original, 'image');
    mainModelClass.recordExportMedia(original, 'derived');
    dialog.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: [out] });
    const link = fs.promises.link.bind(fs.promises);
    jest.spyOn(fs.promises, 'link').mockImplementationOnce(async (source, target) => {
      fs.writeFileSync(target, 'racer');
      return link(source, target);
    });
    await expect(mainModelClass.saveSelectedMedia([original])).resolves.toEqual({
      success: true,
      saved: 1,
      errors: [],
    });
    expect(fs.readFileSync(path.join(out, 'photo'), 'utf8')).toBe('racer');
    expect(fs.readFileSync(path.join(out, 'photo (1)'), 'utf8')).toBe('cached');
    expect(fs.readdirSync(out)).toEqual(['photo', 'photo (1)']);
  });

  test.each(['EPERM', 'ENOTSUP', 'EOPNOTSUPP', 'ENOSYS'])(
    'uses atomic no-replace rename when hard links fail with %s',
    async (code) => {
      const out = path.join(tempDir, "output ' with spaces");
      const original = path.join(tempDir, 'photo.jpg');
      fs.mkdirSync(out);
      fs.writeFileSync(original, 'original');
      fs.symlinkSync(original, path.join(mainModelClass.static_dir, 'big', 'linked.jpg'));
      mainModelClass.authorizedMedia.set(original, 'image');
      mainModelClass.recordExportMedia(original, 'linked.jpg');
      dialog.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: [out] });
      // The global link() stub would break the real fallback; emulate its exclusive-copy behaviour.
      const exclusiveCopy = async (source, target) => {
        await fs.promises.copyFile(source, target, fs.constants.COPYFILE_EXCL);
        await fs.promises.unlink(source);
      };
      renameNoReplace.mockImplementationOnce(exclusiveCopy).mockImplementationOnce(exclusiveCopy);
      const link = jest.spyOn(fs.promises, 'link').mockImplementation(async (_source, target) => {
        fs.writeFileSync(target, 'racer');
        throw Object.assign(new Error('Hard links unavailable'), { code });
      });

      await expect(mainModelClass.saveSelectedMedia([original])).resolves.toEqual({
        success: true,
        saved: 1,
        errors: [],
      });
      expect(link).toHaveBeenCalledTimes(1);
      expect(fs.readFileSync(path.join(out, 'photo.jpg'), 'utf8')).toBe('racer');
      expect(fs.readFileSync(path.join(out, 'photo (1).jpg'), 'utf8')).toBe('original');
      expect(fs.readdirSync(out).sort()).toEqual(['photo (1).jpg', 'photo.jpg']);
    }
  );

  test('reports rename fallback failures without publishing or leaving a temporary file', async () => {
    const out = path.join(tempDir, 'out');
    const original = path.join(tempDir, 'photo.jpg');
    fs.mkdirSync(out);
    fs.writeFileSync(original, 'original');
    fs.symlinkSync(original, path.join(mainModelClass.static_dir, 'big', 'linked.jpg'));
    mainModelClass.authorizedMedia.set(original, 'image');
    mainModelClass.recordExportMedia(original, 'linked.jpg');
    dialog.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: [out] });
    jest.spyOn(fs.promises, 'link').mockRejectedValue(Object.assign(new Error('Unsupported'), { code: 'ENOTSUP' }));
    renameNoReplace.mockRejectedValueOnce(new Error('Atomic rename unavailable'));
    const result = await mainModelClass.saveSelectedMedia([original]);
    expect(result.success).toBe(false);
    expect(result.saved).toBe(0);
    expect(result.errors[0].message).toContain('Atomic rename unavailable');
    expect(fs.readdirSync(out)).toEqual([]);
  });

  test('rename fallback never replaces an existing symlink to the source', async () => {
    const out = path.join(tempDir, 'out');
    const original = path.join(tempDir, 'photo.jpg');
    fs.mkdirSync(out);
    fs.writeFileSync(original, 'original');
    fs.symlinkSync(original, path.join(mainModelClass.static_dir, 'big', 'linked.jpg'));
    mainModelClass.authorizedMedia.set(original, 'image');
    mainModelClass.recordExportMedia(original, 'linked.jpg');
    fs.symlinkSync(original, path.join(out, 'photo.jpg'));
    dialog.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: [out] });
    jest.spyOn(fs.promises, 'link').mockRejectedValue(Object.assign(new Error('Unsupported'), { code: 'EPERM' }));
    await expect(mainModelClass.saveSelectedMedia([original])).resolves.toEqual({
      success: true,
      saved: 1,
      errors: [],
    });
    expect(fs.lstatSync(path.join(out, 'photo.jpg')).isSymbolicLink()).toBe(true);
    expect(fs.readFileSync(original, 'utf8')).toBe('original');
    expect(fs.readFileSync(path.join(out, 'photo (1).jpg'), 'utf8')).toBe('original');
  });

  test('shares the lock with Save As and detects changes while the directory dialog is open', async () => {
    const original = path.join(tempDir, 'photo.jpg');
    fs.writeFileSync(original, 'original');
    fs.symlinkSync(original, path.join(mainModelClass.static_dir, 'big', 'linked.jpg'));
    mainModelClass.authorizedMedia.set(original, 'image');
    mainModelClass.recordExportMedia(original, 'linked.jpg');
    let resolveDialog;
    dialog.showOpenDialog.mockImplementation(() => new Promise((resolve) => (resolveDialog = resolve)));
    const batch = mainModelClass.saveSelectedMedia([original]);
    expect((await mainModelClass.saveCurrentMedia({ origPath: original })).success).toBe(false);
    expect((await mainModelClass.saveSelectedMedia([original])).success).toBe(false);
    fs.writeFileSync(original, 'changed');
    resolveDialog({ canceled: false, filePaths: [tempDir] });
    const result = await batch;
    expect(result.saved).toBe(0);
    expect(result.errors[0].origPath).toBe(original);
    expect(fs.readdirSync(tempDir).filter((name) => name.startsWith('.sht-vr-export-'))).toEqual([]);
    dialog.showSaveDialog.mockResolvedValue({ canceled: true });
    await expect(mainModelClass.saveCurrentMedia({ origPath: original })).resolves.toEqual({ cancelled: true });
    let resolveSave;
    dialog.showSaveDialog.mockImplementation(() => new Promise((resolve) => (resolveSave = resolve)));
    const single = mainModelClass.saveCurrentMedia({ origPath: original });
    expect((await mainModelClass.saveSelectedMedia([original])).success).toBe(false);
    resolveSave({ canceled: true });
    await single;
  });
});
