const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
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

function getCacheName(filePath, suffix = '') {
  const parsed = path.parse(filePath);
  const hash = crypto.createHash('sha256').update(filePath).digest('hex').slice(0, 12);
  return `${parsed.name}-${fs.statSync(filePath).size}-${hash}${suffix}${parsed.ext}`;
}

function getInsta360CacheName(filePath) {
  const parsed = path.parse(filePath);
  const hash = crypto.createHash('sha256').update(filePath).digest('hex').slice(0, 12);
  return `${parsed.name}-${fs.statSync(filePath).size}-${hash}-insta360-v6.jpg`;
}

function writeJpeg(filePath) {
  fs.writeFileSync(filePath, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
}

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

    const rawBigName = getCacheName(filePath);
    const convertedBigName = getCacheName(filePath, '-h264');
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

    const originalBigPath = path.join(tempDir, '.sht-vr-player', 'static', 'big', getCacheName(filePath));
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
            const outputPath = path.join(tempDir, '.sht-vr-player', 'static', 'big', getCacheName(filePath, '-h264'));
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

  test('uses distinct cache entries for same-named, same-sized media in different directories', () => {
    const firstDirectory = path.join(tempDir, 'first');
    const secondDirectory = path.join(tempDir, 'second');
    fs.mkdirSync(firstDirectory);
    fs.mkdirSync(secondDirectory);
    const firstFile = path.join(firstDirectory, 'photo.jpg');
    const secondFile = path.join(secondDirectory, 'photo.jpg');
    fs.writeFileSync(firstFile, 'image');
    fs.writeFileSync(secondFile, 'image');

    const firstResult = Media.saveImage(firstFile, { webContents: { send: jest.fn() } });
    const secondResult = Media.saveImage(secondFile, { webContents: { send: jest.fn() } });
    const bigDir = path.join(tempDir, '.sht-vr-player', 'static', 'big');

    expect(firstResult.bigName).not.toBe(secondResult.bigName);
    expect(fs.realpathSync(path.join(bigDir, firstResult.bigName))).toBe(firstFile);
    expect(fs.realpathSync(path.join(bigDir, secondResult.bigName))).toBe(secondFile);
  });

  test('converts an Insta360 photo into cached JPEG panorama and thumbnail after ffmpeg succeeds', async () => {
    const filePath = path.join(tempDir, 'one-x2.INSP');
    fs.writeFileSync(filePath, 'dual-fisheye');
    const bigName = getInsta360CacheName(filePath);
    const bigPath = path.join(tempDir, '.sht-vr-player', 'static', 'big', bigName);
    const thumpPath = path.join(tempDir, '.sht-vr-player', 'static', 'small', bigName);
    const child = {
      stderr: { on: jest.fn() },
      on: jest.fn((event, callback) => {
        if (event === 'close') {
          setTimeout(() => {
            writeJpeg(bigPath);
            callback(0);
          }, 0);
        }
      }),
    };
    spawn.mockReturnValueOnce(child);
    const gm = require('gm');
    gm.mockImplementationOnce(() => ({
      resize: jest.fn().mockReturnThis(),
      autoOrient: jest.fn().mockReturnThis(),
      write: jest.fn((_target, callback) => {
        writeJpeg(thumpPath);
        callback(null);
      }),
    }));

    const result = await Media.saveInsta360Image(filePath, { webContents: { send: jest.fn() } });

    expect(result).toEqual({
      error: null,
      type: 'image',
      origPath: filePath,
      thumpName: bigName,
      bigName,
    });
    expect(spawn).toHaveBeenCalledWith(
      'ffmpeg',
      expect.arrayContaining([
        '-i',
        filePath,
        '-vf',
        'v360=input=dfisheye:output=equirect:ih_fov=199:iv_fov=199:w=6080:h=3040:interp=lanczos:yaw=0:pitch=0:roll=180',
        '-frames:v',
        '1',
        bigPath,
      ])
    );
    expect(fs.existsSync(bigPath)).toBe(true);
    expect(fs.existsSync(thumpPath)).toBe(true);
  });

  test('reuses a complete Insta360 cache without running ffmpeg again', async () => {
    const filePath = path.join(tempDir, 'one-x2.insp');
    fs.writeFileSync(filePath, 'dual-fisheye');
    const bigName = getInsta360CacheName(filePath);
    const bigDir = path.join(tempDir, '.sht-vr-player', 'static', 'big');
    const smallDir = path.join(tempDir, '.sht-vr-player', 'static', 'small');
    writeJpeg(path.join(bigDir, bigName));
    writeJpeg(path.join(smallDir, bigName));

    const result = await Media.saveInsta360Image(filePath, { webContents: { send: jest.fn() } });

    expect(result.error).toBeNull();
    expect(result.bigName).toBe(bigName);
    expect(spawn).not.toHaveBeenCalled();
  });

  test('reports converter failures and removes partial Insta360 cache files', async () => {
    const filePath = path.join(tempDir, 'broken.insp');
    fs.writeFileSync(filePath, 'dual-fisheye');
    const bigName = getInsta360CacheName(filePath);
    const bigPath = path.join(tempDir, '.sht-vr-player', 'static', 'big', bigName);
    const child = {
      stderr: { on: jest.fn((event, callback) => callback(Buffer.from('conversion failed'))) },
      on: jest.fn((event, callback) => {
        if (event === 'close') {
          setTimeout(() => {
            fs.writeFileSync(bigPath, 'partial output');
            callback(1);
          }, 0);
        }
      }),
    };
    spawn.mockReturnValueOnce(child);

    const result = await Media.saveInsta360Image(filePath, { webContents: { send: jest.fn() } });

    expect(result).toMatchObject({ type: 'image', origPath: filePath });
    expect(result.error).toBeInstanceOf(Error);
    expect(fs.existsSync(bigPath)).toBe(false);
    expect(fs.existsSync(path.join(tempDir, '.sht-vr-player', 'static', 'small', bigName))).toBe(false);
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
        latitude: 50.4501,
        longitude: 30.5234,
      })
    ).toEqual(
      expect.arrayContaining([
        { key: 'dimensions', label: 'Dimensions', value: '1920 × 1080' },
        { key: 'camera-make', label: 'Camera make', value: 'Example Camera' },
        { key: 'exposure', label: 'Exposure', value: '1/125 s' },
        { key: 'location', label: 'Location', value: '50.450100° N, 30.523400° E' },
      ])
    );
  });

  test('preserves non-reciprocal exposure values', () => {
    expect(formatImageMetadata({ ExposureTime: 0.8 })).toContainEqual({
      key: 'exposure',
      label: 'Exposure',
      value: '0.8 s',
    });
  });

  test('returns an empty result when an image has no EXIF metadata', async () => {
    exifr.parse.mockResolvedValue({});

    await expect(Media.getMetadata('/media/plain.png', 'image')).resolves.toEqual([]);
  });

  test('normalizes ffprobe video fields and reports parser failures safely', async () => {
    const rawMetadata = {
      format: { format_long_name: 'QuickTime / MOV', duration: '65.2', tags: { title: 'Holiday' } },
      streams: [
        {
          codec_type: 'video',
          codec_long_name: 'H.264',
          width: 1920,
          height: 1080,
          avg_frame_rate: '0/0',
          r_frame_rate: '30000/1001',
        },
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
    await expect(Media.getMetadata('/media/broken.mp4', 'video')).rejects.toThrow('Unable to read video metadata.');
  });

  test('carries duration rounding into the next minute', () => {
    expect(formatVideoMetadata({ format: { duration: '59.99' } })).toContainEqual({
      key: 'duration',
      label: 'Duration',
      value: '1:00',
    });
  });
});
