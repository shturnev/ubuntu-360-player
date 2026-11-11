const fs = require('fs');
const os = require('os');
const path = require('path');
const { Helper } = require('../../src/models/Helper');

describe('Helper', () => {
  let tempDir;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sht-vr-helper-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  test('creates a directory when it does not exist', () => {
    const target = path.join(tempDir, 'nested', 'media');
    expect(Helper.checkDir(target)).toBe(1);
    expect(fs.existsSync(target)).toBe(true);
    expect(Helper.isFileExists(target)).toBe(true);
  });
});
