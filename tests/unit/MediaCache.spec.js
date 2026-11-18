const fs = require('fs');
const os = require('os');
const path = require('path');

jest.mock('electron', () => ({ dialog: { showSaveDialog: jest.fn() }, ipcMain: { on: jest.fn() } }));
jest.mock('trash', () => jest.fn());
jest.mock('electron-updater', () => ({ autoUpdater: { on: jest.fn() } }));

const mediaCache = require('../../src/models/mediaCache');
const { MainModelClass } = require('../../src/models/MainModelClass');

const denied = () => Object.assign(new Error('privilege not held'), { code: 'EPERM' });

describe('media cache without symlink privileges', () => {
  let dir;
  let big;
  let original;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'media-cache-'));
    big = path.join(dir, 'big');
    fs.mkdirSync(big);
    original = path.join(dir, 'original.bin');
    fs.writeFileSync(original, 'original bytes');
    jest.spyOn(fs, 'symlinkSync').mockImplementation(() => {
      throw denied();
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
    mediaCache.clearSources();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('copies images and leaves the original untouched', () => {
    const link = path.join(big, 'image.jpg');
    expect(mediaCache.linkOriginal(original, link, 'image')).toBe('copy');
    expect(fs.readFileSync(link, 'utf8')).toBe('original bytes');
    expect(fs.statSync(link).ino).not.toBe(fs.statSync(original).ino);
    expect(fs.readdirSync(big)).toEqual(['image.jpg']);
  });

  it('hard-links videos instead of copying them', () => {
    const link = path.join(big, 'video.mp4');
    expect(mediaCache.linkOriginal(original, link, 'video')).toBe('hardlink');
    expect(fs.statSync(link).ino).toBe(fs.statSync(original).ino);
    fs.unlinkSync(link);
    expect(fs.readFileSync(original, 'utf8')).toBe('original bytes');
  });

  it('serves videos from their location when a hard link is impossible', () => {
    jest.spyOn(fs, 'linkSync').mockImplementation(() => {
      throw Object.assign(new Error('cross-device'), { code: 'EXDEV' });
    });
    const link = path.join(big, 'video.mp4');
    expect(mediaCache.linkOriginal(original, link, 'video')).toBe('source');
    expect(fs.existsSync(link)).toBe(false);
    expect(mediaCache.getSource('video.mp4')).toBe(original);
  });

  it('does not hide real errors', () => {
    fs.symlinkSync.mockImplementation(() => {
      throw Object.assign(new Error('disk failure'), { code: 'EIO' });
    });
    expect(() => mediaCache.linkOriginal(original, path.join(big, 'x.jpg'), 'image')).toThrow('disk failure');
  });

  it('records, validates and revokes directly served originals', () => {
    const model = new MainModelClass(null, { initialize: jest.fn() });
    model.static_dir = dir;
    mediaCache.registerSource('video.mp4', original);
    model.authorizedMedia.set(original, 'video');

    const record = model.recordExportMedia(original, 'video.mp4');
    expect(record).toMatchObject({ direct: true, sourcePath: original });
    expect(model.validateExportMedia(original, record).size).toBe(14);

    fs.unlinkSync(original);
    fs.writeFileSync(original, 'replaced');
    expect(() => model.validateExportMedia(original, record)).toThrow('The cached media file has changed.');

    mediaCache.unregisterSource('video.mp4');
    expect(() => model.validateExportMedia(original, record)).toThrow();
  });
});
