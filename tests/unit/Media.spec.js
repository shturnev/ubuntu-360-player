const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { EventEmitter } = require('events');
const { execFile, exec, spawn } = require('child_process');

jest.mock('exifr', () => ({ parse: jest.fn() }));
jest.mock('../../src/models/mediaTools', () => jest.requireActual('./linuxTools'));

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

function writePng(filePath) {
  fs.writeFileSync(filePath, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
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
    jest.restoreAllMocks();
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

  test('checks INSV decoding without a shell and reports decoder failures', async () => {
    const file = path.join(tempDir, 'lens name.insv');
    execFile.mockImplementationOnce((_command, _args, _options, callback) =>
      callback(null, '', '[Parsed_showinfo_0] n:   0 pts:  30 pts_time:0.001')
    );
    await expect(Media.verifyInsvVideo(file, 1)).resolves.toBe(0.001);
    expect(execFile).toHaveBeenCalledWith(
      'ffmpeg',
      expect.arrayContaining(['-xerror', '-copyts', '-an', '-i', file, '-map', '0:v:0']),
      expect.objectContaining({ timeout: 30000 }),
      expect.any(Function)
    );
    const args = execFile.mock.calls[0][1];
    expect(args.indexOf('-an')).toBeLessThan(args.indexOf('-i'));
    execFile.mockImplementationOnce((_command, _args, _options, callback) => callback(new Error('decode failed')));
    await expect(Media.verifyInsvVideo(file, 1)).rejects.toThrow('Unable to decode an INSV lens');
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
    fs.writeFileSync(secondFile, 'imagf');

    const firstResult = Media.saveImage(firstFile, { webContents: { send: jest.fn() } });
    const secondResult = Media.saveImage(secondFile, { webContents: { send: jest.fn() } });
    const bigDir = path.join(tempDir, '.sht-vr-player', 'static', 'big');

    expect(firstResult.bigName).not.toBe(secondResult.bigName);
    expect(fs.readFileSync(path.join(bigDir, firstResult.bigName), 'utf8')).toBe('image');
    expect(fs.readFileSync(path.join(bigDir, secondResult.bigName), 'utf8')).toBe('imagf');
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

  test('serializes INSP conversions across calls, skips cancelled jobs and continues after errors', async () => {
    const files = ['first.insp', 'cancelled.insp', 'last.insp'].map((name) => path.join(tempDir, name));
    files.forEach((file) => fs.writeFileSync(file, 'image'));
    const children = [];
    spawn.mockImplementation(() => {
      const child = new EventEmitter();
      child.stderr = new EventEmitter();
      child.kill = jest.fn();
      children.push(child);
      return child;
    });
    const gm = require('gm');
    gm.mockImplementation(() => ({
      resize: jest.fn().mockReturnThis(),
      autoOrient: jest.fn().mockReturnThis(),
      write: jest.fn((target, callback) => {
        writeJpeg(target);
        callback(null);
      }),
    }));

    const controller = new AbortController();
    const first = Media.saveInsta360Image(files[0], null);
    const cancelled = Media.saveInsta360Image(files[1], null, undefined, { signal: controller.signal });
    const last = Media.saveInsta360Image(files[2], null);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(children).toHaveLength(1);
    controller.abort();
    children[0].emit('close', 1);
    expect((await first).error).toBeInstanceOf(Error);
    expect((await cancelled).error.message).toMatch(/cancelled/);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(children).toHaveLength(2);
    writeJpeg(path.join(tempDir, '.sht-vr-player', 'static', 'big', getInsta360CacheName(files[2])));
    children[1].emit('close', 0);
    expect((await last).error).toBeNull();
    expect(spawn).toHaveBeenCalledTimes(2);
  });

  test('waits for a cancelled INSP converter to exit and removes its partial output', async () => {
    const file = path.join(tempDir, 'active.insp');
    fs.writeFileSync(file, 'image');
    const output = path.join(tempDir, '.sht-vr-player', 'static', 'big', getInsta360CacheName(file));
    const child = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = jest.fn();
    spawn.mockReturnValueOnce(child);
    const controller = new AbortController();
    let finished = false;
    const pending = Media.saveInsta360Image(file, null, undefined, { signal: controller.signal }).then((result) => {
      finished = true;
      return result;
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    fs.writeFileSync(output, 'partial');
    controller.abort();
    await Promise.resolve();
    expect(child.kill).toHaveBeenCalledTimes(1);
    expect(finished).toBe(false);
    child.emit('close', null);
    expect((await pending).error.message).toMatch(/cancelled/);
    expect(fs.existsSync(output)).toBe(false);
  });
  function mockOrientationRender(writeOutput) {
    const child = {
      stderr: { on: jest.fn() },
      on: jest.fn((event, callback) => {
        if (event === 'close') {
          setTimeout(() => {
            writeOutput(spawn.mock.calls[0][1].at(-1));
            callback(0);
          }, 0);
        }
      }),
    };
    spawn.mockReturnValueOnce(child);
  }

  test('saves an orientation correction with the same rotation mapping as the preview', async () => {
    const filePath = path.join(tempDir, 'panorama.jpg');
    fs.writeFileSync(filePath, 'image');
    const bigName = getCacheName(filePath);
    const bigPath = path.join(tempDir, '.sht-vr-player', 'static', 'big', bigName);
    const thumpPath = path.join(tempDir, '.sht-vr-player', 'static', 'small', bigName);
    writeJpeg(bigPath);
    mockOrientationRender(writeJpeg);
    const gm = require('gm');
    gm.mockImplementationOnce(() => ({
      resize: jest.fn().mockReturnThis(),
      autoOrient: jest.fn().mockReturnThis(),
      write: jest.fn((target, callback) => {
        writeJpeg(target);
        callback(null);
      }),
    }));

    await expect(Media.saveOrientationCorrection(filePath, { yaw: -5.25, pitch: 18, roll: 0 })).resolves.toEqual({
      bigName,
    });

    expect(spawn).toHaveBeenCalledWith(
      'ffmpeg',
      expect.arrayContaining([
        '-vf',
        'v360=input=equirect:output=equirect:yaw=-5.25:pitch=-18:roll=0:rorder=ryp:interp=lanczos',
      ])
    );
    expect(execFile).toHaveBeenCalledWith(
      'perl',
      expect.arrayContaining(['-TagsFromFile', filePath, '-EXIF']),
      expect.any(Function)
    );
    expect(fs.existsSync(bigPath)).toBe(true);
    expect(fs.existsSync(thumpPath)).toBe(true);
  });

  test('preserves PNG bytes and extension when saving an orientation correction', async () => {
    const filePath = path.join(tempDir, 'panorama.png');
    fs.writeFileSync(filePath, 'image');
    const bigName = getCacheName(filePath);
    const bigPath = path.join(tempDir, '.sht-vr-player', 'static', 'big', bigName);
    const thumpPath = path.join(tempDir, '.sht-vr-player', 'static', 'small', bigName);
    writePng(bigPath);
    mockOrientationRender(writePng);
    const gm = require('gm');
    gm.mockImplementationOnce(() => ({
      resize: jest.fn().mockReturnThis(),
      autoOrient: jest.fn().mockReturnThis(),
      write: jest.fn((target, callback) => {
        writePng(target);
        callback(null);
      }),
    }));

    await expect(Media.saveOrientationCorrection(filePath, { yaw: 0, pitch: 0, roll: 0 })).resolves.toEqual({
      bigName,
    });

    const args = spawn.mock.calls[0][1];
    expect(args).not.toContain('-q:v');
    expect(args.at(-1)).toMatch(/\.png\.\d+-\d+\.png$/);
    expect(fs.readFileSync(bigPath).subarray(0, 8)).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    );
    expect(fs.readFileSync(thumpPath).subarray(0, 8)).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    );
  });

  test('keeps the existing cache if copying EXIF during orientation correction fails', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    const filePath = path.join(tempDir, 'panorama.jpg');
    fs.writeFileSync(filePath, 'image');
    const bigName = getCacheName(filePath);
    const bigPath = path.join(tempDir, '.sht-vr-player', 'static', 'big', bigName);
    writeJpeg(bigPath);
    const original = fs.readFileSync(bigPath);
    mockOrientationRender(writeJpeg);
    execFile.mockImplementationOnce((_command, _args, callback) => callback(new Error('ExifTool failed'), '', ''));

    await expect(Media.saveOrientationCorrection(filePath, { yaw: 0, pitch: 0, roll: 0 })).rejects.toThrow(
      'Unable to preserve EXIF metadata.'
    );
    expect(fs.readFileSync(bigPath)).toEqual(original);
  });

  test('reports a missing Perl runtime without replacing cached images', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    const filePath = path.join(tempDir, 'panorama.jpg');
    const bigPath = path.join(tempDir, '.sht-vr-player', 'static', 'big', 'derived.jpg');
    fs.writeFileSync(filePath, 'image');
    writeJpeg(bigPath);
    const original = fs.readFileSync(bigPath);
    execFile.mockImplementationOnce((_command, _args, callback) =>
      callback(Object.assign(new Error('spawn perl ENOENT'), { code: 'ENOENT' }), '', '')
    );

    await expect(Media.syncCachedExif(filePath, bigPath, () => true)).rejects.toThrow(
      'Perl is not installed or not available in PATH.'
    );
    expect(fs.readFileSync(bigPath)).toEqual(original);
    expect(fs.readdirSync(path.dirname(bigPath))).toEqual(['derived.jpg']);
  });

  test('accepts the Insta360 trailer warning while saving an orientation correction', async () => {
    const filePath = path.join(tempDir, 'panorama.jpg');
    fs.writeFileSync(filePath, 'image');
    const bigName = getCacheName(filePath);
    const bigPath = path.join(tempDir, '.sht-vr-player', 'static', 'big', bigName);
    writeJpeg(bigPath);
    mockOrientationRender(writeJpeg);
    execFile.mockImplementationOnce((_command, _args, callback) =>
      callback(
        null,
        '1 image files updated',
        'Warning: [minor] Use ExtractEmbedded option to extract timed metadata from Insta360 trailer - source.insp\n'
      )
    );
    const gm = require('gm');
    gm.mockImplementationOnce(() => ({
      resize: jest.fn().mockReturnThis(),
      autoOrient: jest.fn().mockReturnThis(),
      write: jest.fn((target, callback) => {
        writeJpeg(target);
        callback(null);
      }),
    }));
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(Media.saveOrientationCorrection(filePath, { yaw: 0, pitch: 0, roll: 0 })).resolves.toEqual({
      bigName,
    });
    expect(warn).toHaveBeenCalledWith(
      'ExifTool: Use ExtractEmbedded option to extract timed metadata from Insta360 trailer'
    );
  });

  test('rejects unexpected EXIF warnings rather than silently accepting them', async () => {
    const filePath = path.join(tempDir, 'panorama.jpg');
    fs.writeFileSync(filePath, 'image');
    const bigPath = path.join(tempDir, '.sht-vr-player', 'static', 'big', getCacheName(filePath));
    writeJpeg(bigPath);
    const original = fs.readFileSync(bigPath);
    mockOrientationRender(writeJpeg);
    execFile.mockImplementationOnce((_command, _args, callback) =>
      callback(null, '', 'Warning: [minor] Invalid EXIF data - source.jpg\n')
    );
    const logError = jest.spyOn(console, 'error').mockImplementation(() => {});

    await expect(Media.saveOrientationCorrection(filePath, { yaw: 0, pitch: 0, roll: 0 })).rejects.toThrow(
      'Unable to preserve EXIF metadata.'
    );
    expect(fs.readFileSync(bigPath)).toEqual(original);
    expect(logError).toHaveBeenCalledWith(
      'ExifTool could not preserve EXIF metadata:',
      'Warning: [minor] Invalid EXIF data - source.jpg'
    );
  });

  test('restores both cache files when replacing the thumbnail fails', async () => {
    const filePath = path.join(tempDir, 'panorama.jpg');
    fs.writeFileSync(filePath, 'image');
    const bigName = getCacheName(filePath);
    const bigPath = path.join(tempDir, '.sht-vr-player', 'static', 'big', bigName);
    const thumpPath = path.join(tempDir, '.sht-vr-player', 'static', 'small', bigName);
    const originalBig = Buffer.from([0xff, 0xd8, 0xff, 0x01, 0xff, 0xd9]);
    const originalThumbnail = Buffer.from([0xff, 0xd8, 0xff, 0x02, 0xff, 0xd9]);
    fs.writeFileSync(bigPath, originalBig);
    fs.writeFileSync(thumpPath, originalThumbnail);
    mockOrientationRender(writeJpeg);
    const gm = require('gm');
    gm.mockImplementationOnce(() => ({
      resize: jest.fn().mockReturnThis(),
      autoOrient: jest.fn().mockReturnThis(),
      write: jest.fn((target, callback) => {
        writeJpeg(target);
        callback(null);
      }),
    }));
    const renameSync = fs.renameSync;
    let renameCount = 0;
    jest.spyOn(fs, 'renameSync').mockImplementation((source, destination) => {
      renameCount += 1;
      if (renameCount === 4) throw new Error('Unable to replace thumbnail');
      return renameSync(source, destination);
    });

    await expect(Media.saveOrientationCorrection(filePath, { yaw: 0, pitch: 0, roll: 0 })).rejects.toThrow(
      'Unable to replace thumbnail'
    );

    expect(fs.readFileSync(bigPath)).toEqual(originalBig);
    expect(fs.readFileSync(thumpPath)).toEqual(originalThumbnail);
  });

  test('restores the panorama when creating the thumbnail backup fails', async () => {
    const filePath = path.join(tempDir, 'panorama.jpg');
    fs.writeFileSync(filePath, 'image');
    const bigName = getCacheName(filePath);
    const bigPath = path.join(tempDir, '.sht-vr-player', 'static', 'big', bigName);
    const thumpPath = path.join(tempDir, '.sht-vr-player', 'static', 'small', bigName);
    const originalBig = Buffer.from([0xff, 0xd8, 0xff, 0x01, 0xff, 0xd9]);
    const originalThumbnail = Buffer.from([0xff, 0xd8, 0xff, 0x02, 0xff, 0xd9]);
    fs.writeFileSync(bigPath, originalBig);
    fs.writeFileSync(thumpPath, originalThumbnail);
    mockOrientationRender(writeJpeg);
    const gm = require('gm');
    gm.mockImplementationOnce(() => ({
      resize: jest.fn().mockReturnThis(),
      autoOrient: jest.fn().mockReturnThis(),
      write: jest.fn((target, callback) => {
        writeJpeg(target);
        callback(null);
      }),
    }));
    const renameSync = fs.renameSync;
    jest.spyOn(fs, 'renameSync').mockImplementation((source, destination) => {
      if (source === thumpPath && destination.endsWith('.backup')) {
        throw new Error('Unable to back up thumbnail');
      }
      return renameSync(source, destination);
    });

    await expect(Media.saveOrientationCorrection(filePath, { yaw: 0, pitch: 0, roll: 0 })).rejects.toThrow(
      'Unable to back up thumbnail'
    );

    expect(fs.readFileSync(bigPath)).toEqual(originalBig);
    expect(fs.readFileSync(thumpPath)).toEqual(originalThumbnail);
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

  test('reads embedded camera EXIF and video metadata from the first INSV lens', async () => {
    jest.spyOn(Media, 'probeVideoMetadata').mockResolvedValue({
      format: { duration: '30' },
      streams: [{ codec_type: 'video', width: 2880, height: 2880, codec_name: 'h264' }],
    });
    execFile.mockImplementationOnce((_command, _args, _options, callback) =>
      callback(null, JSON.stringify([{ Model: 'Insta360 One2', SerialNumber: 'camera-id', Firmware: 'v1' }]))
    );
    const pair = { paths: ['/media/00.insv', '/media/10.insv'] };
    const entries = await Media.getInsvMetadata(pair);
    expect(entries).toEqual(
      expect.arrayContaining([
        { key: 'second-lens', label: 'Second lens file', value: '10.insv' },
        { key: 'dimensions', label: 'Lens dimensions', value: '2880 × 2880' },
        { key: 'camera-model', label: 'Camera model', value: 'Insta360 One2' },
        { key: 'serial-number', label: 'Camera serial number', value: 'camera-id' },
        { key: 'firmware', label: 'Firmware', value: 'v1' },
      ])
    );
    expect(execFile).toHaveBeenCalledWith(
      'perl',
      expect.arrayContaining(['-ee', '-json', '-Model', '/media/00.insv']),
      expect.objectContaining({ timeout: 30000 }),
      expect.any(Function)
    );
  });

  test('reports invalid or unavailable INSV EXIF rather than returning partial metadata', async () => {
    jest.spyOn(Media, 'probeVideoMetadata').mockResolvedValue({});
    execFile.mockImplementationOnce((_command, _args, _options, callback) => callback(null, 'not json'));
    await expect(Media.getInsvMetadata({ paths: ['/media/00.insv', '/media/10.insv'] })).rejects.toThrow(
      'Unable to read INSV metadata'
    );
  });

  test('carries duration rounding into the next minute', () => {
    expect(formatVideoMetadata({ format: { duration: '59.99' } })).toContainEqual({
      key: 'duration',
      label: 'Duration',
      value: '1:00',
    });
  });
});
