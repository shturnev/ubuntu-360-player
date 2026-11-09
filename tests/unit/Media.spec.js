const fs = require('fs');
const os = require('os');
const path = require('path');
const { exec } = require('child_process');

jest.mock('gm', () => {
  const gmMock = jest.fn(() => ({
    resize: jest.fn().mockReturnThis(),
    autoOrient: jest.fn().mockReturnThis(),
    write: jest.fn((_target, callback) => callback(null))
  }));

  return gmMock;
});

jest.mock('child_process', () => ({
  exec: jest.fn((_command, callback) => callback(null, '', ''))
}));

const { Media } = require('../../src/models/Media');

describe('Media', () => {
  let tempDir;
  let originalHome;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sht-vr-media-'));
    originalHome = process.env.SHT_VR_HOME;
    process.env.SHT_VR_HOME = tempDir;
    fs.mkdirSync(path.join(tempDir, '.sht-vr-player', 'static', 'small'), { recursive: true });
    fs.mkdirSync(path.join(tempDir, '.sht-vr-player', 'static', 'big'), { recursive: true });
  });

  afterEach(() => {
    if (originalHome) {
      process.env.SHT_VR_HOME = originalHome;
    } else {
      delete process.env.SHT_VR_HOME;
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  test('creates a thumbnail payload for a local image file', () => {
    const filePath = path.join(tempDir, 'sample.jpg');
    fs.writeFileSync(filePath, 'not-a-real-image');

    const result = Media.saveImage(filePath, { webContents: { send: jest.fn() } });

    expect(result).toHaveProperty('type', 'image');
    expect(result).toHaveProperty('origPath', filePath);
    expect(result.bigName).toContain('sample');
  });

  test('creates a thumbnail payload for a local video file', () => {
    const filePath = path.join(tempDir, 'clip.mp4');
    fs.writeFileSync(filePath, 'not-a-real-video');

    const result = Media.saveVideo(filePath, { webContents: { send: jest.fn() } });

    expect(result).toHaveProperty('type', 'video');
    expect(result).toHaveProperty('origPath', filePath);
    expect(result.bigName).toContain('clip');
    expect(exec).toHaveBeenCalled();
  });
});
