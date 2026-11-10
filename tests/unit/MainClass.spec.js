const fs = require('fs');
const os = require('os');
const path = require('path');

jest.mock('trash', () => jest.fn(async () => true));

const { MainModelClass, removeFilesHelper } = require('../../src/models/MainModelClass');

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
});
