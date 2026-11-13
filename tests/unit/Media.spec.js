const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile, exec, spawn } = require('child_process');

jest.mock('exifr', () => ({ parse: jest.fn() }));

jest.mock('gm', () => {
  const gmMock = jest.fn(() => ({
    resize: jest.fn().mockReturnThis(),
    autoOrient: jest.fn().mockReturnThis(),
    write: jest.fn((_target, callback) => callback(null)),
  }));

  return gmMock;
});

jest.mock('child_process', () => ({
  exec: jest.fn((_command, callback) => callback(null, '', '')),
  execFile: jest.fn((_command, _args, callback) => callback(null, '', '')),
  spawn: jest.fn(() => ({
    stdout: { on: jest.fn() },
    stderr: { on: jest.fn() },
    on: jest.fn(),
  })),
}));

const exifr = require('exifr');
const { Media, formatImageMetadata, formatVideoMetadata } = require('../../src/models/Media');

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

  test('reuses an existing converted video instead of creating a duplicate original link', () => {
    const filePath = path.join(tempDir, 'reused-video.mp4');
    fs.writeFileSync(filePath, 'not-a-real-video');

    const rawBigName = `reused-video-${fs.statSync(filePath).size}.mp4`;
    const convertedBigName = `reused-video-${fs.statSync(filePath).size}-h264.mp4`;
    const convertedBigPath = path.join(tempDir, '.sht-vr-player', 'static', 'big', convertedBigName);
    fs.writeFileSync(convertedBigPath, 'converted-video');
    fs.symlinkSync(filePath, path.join(tempDir, '.sht-vr-player', 'static', 'big', rawBigName));

    const result = Media.saveVideo(filePath, { webContents: { send: jest.fn() } });

    expect(result.bigName).toBe(convertedBigName);
    expect(result.thumpName).toBe(`${path.parse(convertedBigName).name}.jpg`);
    expect(fs.existsSync(convertedBigPath)).toBe(true);
    expect(fs.existsSync(path.join(tempDir, '.sht-vr-player', 'static', 'big', rawBigName))).toBe(false);
    expect(execFile).toHaveBeenCalled();
  });

  test('only creates a compatible MP4 after an explicit conversion request', async () => {
    const filePath = path.join(tempDir, 'hevc-video.mp4');
    fs.writeFileSync(filePath, 'not-a-real-video');

    const originalBigPath = path.join(
      tempDir,
      '.sht-vr-player',
      'static',
      'big',
      `hevc-video-${fs.statSync(filePath).size}.mp4`
    );
    fs.symlinkSync(filePath, originalBigPath);

    execFile.mockImplementationOnce((_cmd, _args, callback) => {
      callback(
        null,
        JSON.stringify({
          format: { duration: '5.0' },
          streams: [
            { codec_type: 'video', codec_name: 'hevc' },
            { codec_type: 'audio', codec_name: 'aac' },
          ],
        }),
        ''
      );
    });

    const child = {
      stdout: { on: jest.fn() },
      stderr: { on: jest.fn() },
      on: jest.fn((event, handler) => {
        if (event === 'close') {
          setTimeout(() => {
            const outputPath = path.join(
              tempDir,
              '.sht-vr-player',
              'static',
              'big',
              `hevc-video-${fs.statSync(filePath).size}-h264.mp4`
            );
            fs.writeFileSync(outputPath, 'converted-video');
            handler(0);
          }, 0);
        }
      }),
    };
    spawn.mockReturnValue(child);

    const result = await Media.convertVideoFor360(filePath, { webContents: { send: jest.fn() } });

    expect(result.success).toBe(true);
    expect(result.origPath).toBe(filePath);
    expect(result.bigName).toContain('h264');
    expect(fs.existsSync(originalBigPath)).toBe(false);
    expect(execFile).toHaveBeenCalledWith('ffprobe', expect.arrayContaining(['-show_streams']), expect.any(Function));
  });

  test('normalizes image metadata into human-readable entries', () => {
    expect(
      formatImageMetadata({
        ExifImageWidth: 1920,
        ExifImageHeight: 1080,
        Make: 'Example Camera',
        Model: 'X1',
        ExposureTime: 0.008,
        ISO: 200,
      })
    ).toEqual(
      expect.arrayContaining([
        { key: 'dimensions', label: 'Dimensions', value: '1920 × 1080' },
        { key: 'camera-make', label: 'Camera make', value: 'Example Camera' },
        { key: 'exposure', label: 'Exposure', value: '1/125 s' },
      ])
    );
  });

  test('returns an empty result when an image has no EXIF metadata', async () => {
    exifr.parse.mockResolvedValue({});

    await expect(Media.getMetadata('/media/plain.png', 'image')).resolves.toEqual([]);
  });

  test('normalizes ffprobe video fields and reports parser failures safely', async () => {
    const rawMetadata = {
      format: { format_long_name: 'QuickTime / MOV', duration: '65.2', tags: { title: 'Holiday' } },
      streams: [
        { codec_type: 'video', codec_long_name: 'H.264', width: 1920, height: 1080, avg_frame_rate: '30000/1001' },
        { codec_type: 'audio', codec_long_name: 'AAC', channels: 2, channel_layout: 'stereo' },
      ],
    };
    expect(formatVideoMetadata(rawMetadata)).toEqual(
      expect.arrayContaining([
        { key: 'duration', label: 'Duration', value: '1:05.2' },
        { key: 'frame-rate', label: 'Frame rate', value: '29.97 fps' },
        { key: 'audio-channels', label: 'Audio channels', value: '2 (stereo)' },
      ])
    );

    execFile.mockImplementationOnce((_command, _args, callback) => callback(new Error('missing ffprobe')));
    await expect(Media.getMetadata('/media/broken.mp4', 'video')).rejects.toThrow(
      'Unable to read video metadata.'
    );
  });
});
