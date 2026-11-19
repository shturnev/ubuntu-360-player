const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

jest.mock('electron', () => ({
  dialog: { showSaveDialog: jest.fn() },
  ipcMain: { on: jest.fn() },
}));
jest.mock('electron-updater', () => ({ autoUpdater: { on: jest.fn() } }));

const { dialog } = require('electron');
const { Media } = require('../../src/models/Media');
const { MainModelClass } = require('../../src/models/MainModelClass');
const mediaTools = require('../../src/models/mediaTools');

const jpeg = Buffer.from(
  [
    '/9j/4AAQSkZJRgABAQAAAAAAAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgG',
    'BgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/2wBDAQMD',
    'AwQDBAgEBAgQCwkLEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQ',
    'EBAQEBAQEBAQEBAQEBD/wAARCAACAAQDAREAAhEBAxEB/8QAFAABAAAAAAAAAAAA',
    'AAAAAAAACP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/xAAVAQEBAAAAAAAAAAAAAAAA',
    'AAAHCf/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/ADoDFU3/2Q==',
  ].join(''),
  'base64'
);
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAQAAAACAQMAAABFZu8gAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAGUExURQAA/////3vcmSwAAAABYktHRAH/Ai3eAAAAB3RJTUUH6gsQFRgs9uxh6wAAAAxJREFUCNdjYGBgAAAABAABJzQnCgAAAABJRU5ErkJggg==',
  'base64'
);

const tool = (...args) => {
  const invocation = mediaTools.exiftool(args);
  return execFileSync(invocation.command, invocation.args, { stdio: ['ignore', 'pipe', 'pipe'] });
};
const exif = (file) => tool('-b', '-EXIF', file);

function jpegWithUnknownMakerNotes() {
  const tiff = Buffer.alloc(52);
  tiff.write('II');
  tiff.writeUInt16LE(42, 2);
  tiff.writeUInt32LE(8, 4);
  tiff.writeUInt16LE(1, 8);
  tiff.writeUInt16LE(0x8769, 10);
  tiff.writeUInt16LE(4, 12);
  tiff.writeUInt32LE(1, 14);
  tiff.writeUInt32LE(26, 18);
  tiff.writeUInt16LE(1, 26);
  tiff.writeUInt16LE(0x927c, 28);
  tiff.writeUInt16LE(7, 30);
  tiff.writeUInt32LE(8, 32);
  tiff.writeUInt32LE(44, 36);
  tiff.fill(0x9a, 44);
  const payload = Buffer.concat([Buffer.from('Exif\0\0'), tiff]);
  const header = Buffer.alloc(4);
  header.writeUInt16BE(0xffe1, 0);
  header.writeUInt16BE(payload.length + 2, 2);
  return Buffer.concat([jpeg.subarray(0, 2), header, payload, jpeg.subarray(2)]);
}

describe('cached image EXIF', () => {
  let directory;

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sht-vr-exif-'));
  });

  afterEach(() => {
    jest.restoreAllMocks();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  test.each(['jpg', 'png'])(
    'copies the complete EXIF block into derived %s without modifying the source',
    async (ext) => {
      const source = path.join(directory, 'source.jpg');
      const target = path.join(directory, `derived.${ext}`);
      fs.writeFileSync(source, jpeg);
      fs.writeFileSync(target, ext === 'jpg' ? jpeg : png);
      tool('-overwrite_original', '-Make=Example', '-Model=Camera', '-DateTimeOriginal=2024:01:02 03:04:05', source);
      const original = fs.readFileSync(source);
      const originalExif = exif(source);
      expect(originalExif.length).toBeGreaterThan(0);

      await Media.syncCachedExif(source, target, () => true);

      expect(exif(target)).toEqual(originalExif);
      expect(fs.readFileSync(source)).toEqual(original);
    }
  );

  test('removes stale cached EXIF when the source has none and does not touch symlinks', async () => {
    const source = path.join(directory, 'source.jpg');
    const target = path.join(directory, 'derived.jpg');
    const link = path.join(directory, 'link.jpg');
    fs.writeFileSync(source, jpeg);
    fs.writeFileSync(target, jpeg);
    tool('-overwrite_original', '-Make=Old camera', target);
    fs.symlinkSync(source, link);
    await Media.syncCachedExif(source, target, () => true);
    await Media.syncCachedExif(source, link, () => true);
    expect(exif(target)).toHaveLength(0);
    expect(fs.readFileSync(source)).toEqual(jpeg);
    expect(fs.lstatSync(link).isSymbolicLink()).toBe(true);
  });

  test('preserves EXIF from a PNG source in a derived PNG', async () => {
    const source = path.join(directory, 'source.png');
    const target = path.join(directory, 'derived.png');
    fs.writeFileSync(source, png);
    fs.writeFileSync(target, png);
    tool('-overwrite_original', '-EXIF:Make=Camera', source);
    await Media.syncCachedExif(source, target, () => true);
    expect(exif(target)).toEqual(exif(source));
    expect(exif(target).length).toBeGreaterThan(0);
  });

  test('copies the complete EXIF block when the source has unrecognized maker notes', async () => {
    const source = path.join(directory, 'source.insp');
    const target = path.join(directory, 'derived.jpg');
    const original = jpegWithUnknownMakerNotes();
    fs.writeFileSync(source, original);
    fs.writeFileSync(target, jpeg);
    expect(tool('-s3', '-Warning', source).toString()).toContain('Unrecognized MakerNotes');
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});

    await Media.syncCachedExif(source, target, () => true);

    expect(exif(target)).toEqual(exif(source));
    expect(fs.readFileSync(source)).toEqual(original);
    expect(warn).toHaveBeenCalledWith('ExifTool: Unrecognized MakerNotes');
  });

  test('does not replace a derived cache file after its library becomes stale', async () => {
    const source = path.join(directory, 'source.jpg');
    const target = path.join(directory, 'derived.jpg');
    fs.writeFileSync(source, jpeg);
    fs.writeFileSync(target, jpeg);
    tool('-overwrite_original', '-Make=Camera', source);
    let checks = 0;
    await expect(Media.syncCachedExif(source, target, () => ++checks === 1)).rejects.toThrow('changed during import');
    expect(fs.readFileSync(target)).toEqual(jpeg);
    expect(fs.readdirSync(directory).sort()).toEqual(['derived.jpg', 'source.jpg']);
  });

  test('imports an INSP derivative with EXIF and exports the exact cached bytes', async () => {
    const staticDir = path.join(directory, 'static');
    const bigDir = path.join(staticDir, 'big');
    const sourceDir = path.join(directory, 'source');
    fs.mkdirSync(bigDir, { recursive: true });
    fs.mkdirSync(sourceDir);
    const jpg = path.join(sourceDir, 'photo.jpg');
    const source = path.join(sourceDir, 'photo.insp');
    const cached = path.join(bigDir, 'derived.jpg');
    const exported = path.join(directory, 'export.jpg');
    fs.writeFileSync(jpg, jpeg);
    tool('-overwrite_original', '-Make=Insta360', '-Model=Camera', jpg);
    fs.renameSync(jpg, source);
    fs.writeFileSync(cached, jpeg);
    jest
      .spyOn(Media, 'saveInsta360Image')
      .mockImplementation((file, _win, onResult) =>
        onResult({ origPath: file, type: 'image', bigName: 'derived.jpg', thumpName: 'derived.jpg', error: null })
      );
    const send = jest.fn();
    const model = new MainModelClass({ webContents: { send } });
    model.static_dir = staticDir;
    await new Promise((resolve) => {
      send.mockImplementation((channel) => {
        if (channel === 'read-media-file') resolve();
      });
      model.readDir(sourceDir);
    });
    expect(exif(cached)).toEqual(exif(source));
    dialog.showSaveDialog.mockResolvedValue({ canceled: false, filePath: exported });
    await expect(model.saveCurrentMedia({ origPath: source })).resolves.toEqual({ success: true });
    expect(fs.readFileSync(exported)).toEqual(fs.readFileSync(cached));
    expect(exif(exported)).toEqual(exif(source));
  });
});
