const fs = require('fs');
const getTempDir = require('../tempDir');
const path = require('path');
const { validateInsvPair } = require('../../src/models/insvPair');

describe('INSV stream validation', () => {
  let directory;
  let files;
  let metadata;
  let verifyVideo;

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(getTempDir(), 'insv-pair-'));
    files = [path.join(directory, 'first.insv'), path.join(directory, 'second.insv')];
    files.forEach((file) => fs.writeFileSync(file, 'video'));
    verifyVideo = jest.fn().mockResolvedValue(0.001);
    metadata = {
      streams: [
        {
          codec_type: 'video',
          codec_name: 'h264',
          width: 2880,
          height: 2880,
          r_frame_rate: '30000/1001',
          start_time: '0.000000',
          duration: '34.634600',
        },
        { codec_type: 'audio', codec_name: 'aac', channels: 0 },
      ],
    };
  });

  afterEach(() => fs.rmSync(directory, { recursive: true, force: true }));

  test('accepts matching H.264 streams even with an invalid audio description', async () => {
    const probe = jest.fn().mockResolvedValue(metadata);
    await expect(validateInsvPair(files, probe, verifyVideo)).resolves.toMatchObject({ paths: files });
    expect(probe.mock.calls.map(([file]) => file)).toEqual(files);
    expect(verifyVideo.mock.calls.map(([file]) => file)).toEqual(files);
  });

  test.each([
    ['dimensions', { width: 1920 }],
    ['codec', { codec_name: 'hevc' }],
    ['frame rate', { r_frame_rate: '25/1' }],
    ['start timestamp', { start_time: '1' }],
    ['duration', { duration: '33' }],
  ])('rejects incompatible %s', async (_label, difference) => {
    const changed = { streams: [{ ...metadata.streams[0], ...difference }] };
    const probe = jest.fn().mockResolvedValueOnce(metadata).mockResolvedValueOnce(changed);
    await expect(validateInsvPair(files, probe, verifyVideo)).rejects.toThrow(/INSV/);
    expect(verifyVideo).not.toHaveBeenCalled();
  });

  test('rejects a pair sharing an inode', async () => {
    fs.unlinkSync(files[1]);
    fs.linkSync(files[0], files[1]);
    const probe = jest.fn();
    await expect(validateInsvPair(files, probe, verifyVideo)).rejects.toThrow(/distinct/);
    expect(probe).not.toHaveBeenCalled();
  });

  test('rejects a source modified during probing', async () => {
    const probe = jest.fn(async (file) => {
      if (file === files[1]) fs.appendFileSync(file, 'changed');
      return metadata;
    });
    await expect(validateInsvPair(files, probe, verifyVideo)).rejects.toThrow(/changed/);
  });

  test('rejects a lens linking outside its directory', async () => {
    const outside = fs.mkdtempSync(path.join(getTempDir(), 'insv-outside-'));
    try {
      const target = path.join(outside, 'lens.insv');
      fs.writeFileSync(target, 'video');
      fs.unlinkSync(files[1]);
      fs.symlinkSync(target, files[1]);
      await expect(validateInsvPair(files, jest.fn(), verifyVideo)).rejects.toThrow(/same directory/);
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  test('reports probe failures rather than accepting a pair', async () => {
    await expect(
      validateInsvPair(files, jest.fn().mockRejectedValue(new Error('ffprobe failed')), verifyVideo)
    ).rejects.toThrow('ffprobe failed');
  });

  test('rejects a lens that cannot decode even when its metadata matches', async () => {
    verifyVideo.mockResolvedValueOnce().mockRejectedValueOnce(new Error('Unable to decode INSV lens.'));
    await expect(validateInsvPair(files, jest.fn().mockResolvedValue(metadata), verifyVideo)).rejects.toThrow(
      'Unable to decode INSV lens.'
    );
  });

  test('rejects mismatched decoded timestamps despite matching container metadata', async () => {
    verifyVideo.mockResolvedValueOnce(0).mockResolvedValueOnce(0.04);
    await expect(validateInsvPair(files, jest.fn().mockResolvedValue(metadata), verifyVideo)).rejects.toThrow(
      'matching decoded frame timestamps'
    );
  });
});
