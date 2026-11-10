const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile, exec, spawn } = require('child_process');

jest.mock('gm', () => {
  const gmMock = jest.fn(() => ({
    resize: jest.fn().mockReturnThis(),
    autoOrient: jest.fn().mockReturnThis(),
    write: jest.fn((_target, callback) => callback(null))
  }));

  return gmMock;
});

jest.mock('child_process', () => ({
  exec: jest.fn((_command, callback) => callback(null, '', '')),
  execFile: jest.fn((_command, _args, callback) => callback(null, '', '')),
  spawn: jest.fn(() => ({
    stdout: { on: jest.fn() },
    stderr: { on: jest.fn() },
    on: jest.fn()
  }))
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
    jest.clearAllMocks();
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
    expect(execFile).toHaveBeenCalled();
  });

  test('only creates a compatible MP4 after an explicit conversion request', async () => {
    const filePath = path.join(tempDir, 'hevc-video.mp4');
    fs.writeFileSync(filePath, 'not-a-real-video');

    const originalBigPath = path.join(tempDir, '.sht-vr-player', 'static', 'big', `hevc-video-${fs.statSync(filePath).size}.mp4`);
    fs.symlinkSync(filePath, originalBigPath);

    execFile.mockImplementationOnce((_cmd, _args, callback) => {
      callback(null, JSON.stringify({
        format: { duration: '5.0' },
        streams: [
          { codec_type: 'video', codec_name: 'hevc' },
          { codec_type: 'audio', codec_name: 'aac' }
        ]
      }), '');
    });

    const child = {
      stdout: { on: jest.fn() },
      stderr: { on: jest.fn() },
      on: jest.fn((event, handler) => {
        if (event === 'close') {
          setTimeout(() => {
            const outputPath = path.join(tempDir, '.sht-vr-player', 'static', 'big', `hevc-video-${fs.statSync(filePath).size}-h264.mp4`);
            fs.writeFileSync(outputPath, 'converted-video');
            handler(0);
          }, 0);
        }
      })
    };
    spawn.mockReturnValue(child);

    const result = await Media.convertVideoFor360(filePath, { webContents: { send: jest.fn() } });

    expect(result.success).toBe(true);
    expect(result.origPath).toBe(filePath);
    expect(result.bigName).toContain('h264');
    expect(fs.existsSync(originalBigPath)).toBe(false);
    expect(execFile).toHaveBeenCalledWith('ffprobe', expect.arrayContaining(['-show_streams']), expect.any(Function));
  });
});
