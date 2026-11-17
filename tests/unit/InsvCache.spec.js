const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { createInsvThumbnail } = require('../../src/models/insvCache');
const { projectInsvThumbnail } = require('../../src/models/insvThumbnailProjection');

jest.mock('child_process', () => ({ execFile: jest.fn() }));

describe('INSV thumbnail cache', () => {
  let directory;
  let files;
  let cache;
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);

  const makePair = () => ({
    paths: files,
    snapshots: files.map((file) => {
      const { dev, ino, size, mtimeMs, ctimeMs } = fs.statSync(file);
      return { dev, ino, size, mtimeMs, ctimeMs };
    }),
    sampleTime: 1,
  });

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'insv-cache-'));
    cache = path.join(directory, 'small');
    files = [path.join(directory, '00.insv'), path.join(directory, '10.insv')];
    files.forEach((file) => fs.writeFileSync(file, 'original'));
    execFile.mockImplementation((_command, args, _options, callback) => {
      if (args.includes('pipe:0')) {
        return { stdin: { once: jest.fn(), end: jest.fn(() => callback(null, jpeg, '')) } };
      }
      if (args.includes('pipe:1')) {
        callback(null, Buffer.alloc(720 * 720 * 4, 127), '');
        return {};
      }
      const file = args[args.indexOf('-i') + 1];
      const data = fs.readFileSync(file);
      callback(data.equals(jpeg) ? null : Object.assign(new Error('invalid image'), { code: 1 }), '', '');
      return {};
    });
  });

  afterEach(() => {
    jest.resetAllMocks();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  test('projects both lenses and smoothly blends their overlap', () => {
    const first = Buffer.from(Array.from({ length: 16 }, () => [255, 0, 0, 255]).flat());
    const second = Buffer.from(Array.from({ length: 16 }, () => [0, 0, 255, 255]).flat());
    const image = projectInsvThumbnail([first, second], 4, 18, 4);
    const pixel = (x) => [...image.subarray((18 + x) * 4, (18 + x) * 4 + 3)];
    expect(pixel(0)).toEqual([255, 0, 0]);
    expect(pixel(8)).toEqual([0, 0, 255]);
    expect(pixel(4)[0]).toBeGreaterThan(120);
    expect(pixel(4)[2]).toBeGreaterThan(120);
  });

  test('uses the same sample time for both lenses and reuses a complete cache', async () => {
    const pair = makePair();
    const name = await createInsvThumbnail(pair, cache);
    expect(fs.readFileSync(path.join(cache, name))).toEqual(jpeg);
    const decodes = execFile.mock.calls.filter(([, args]) => args.includes('pipe:1') && !args.includes('pipe:0'));
    expect(decodes).toHaveLength(2);
    expect(decodes.map(([, args]) => args[args.indexOf('-i') + 1])).toEqual(files);
    expect(decodes.map(([, args]) => args[args.indexOf('-ss') + 1])).toEqual(['1', '1']);
    execFile.mockClear();
    expect(await createInsvThumbnail(pair, cache)).toBe(name);
    expect(execFile.mock.calls.some(([, args]) => args.includes('pipe:1'))).toBe(false);
  });

  test('regenerates corrupt thumbnails and invalidates when either source changes', async () => {
    const oldPair = makePair();
    const firstName = await createInsvThumbnail(oldPair, cache);
    fs.writeFileSync(path.join(cache, firstName), 'incomplete');
    expect(await createInsvThumbnail(oldPair, cache)).toBe(firstName);
    expect(fs.readFileSync(path.join(cache, firstName))).toEqual(jpeg);
    fs.appendFileSync(files[1], 'changed');
    await expect(createInsvThumbnail(oldPair, cache)).rejects.toThrow(/changed/);
    const newName = await createInsvThumbnail(makePair(), cache);
    expect(newName).not.toBe(firstName);
    fs.unlinkSync(files[0]);
    await expect(createInsvThumbnail(oldPair, cache)).rejects.toThrow();
  });

  test('surfaces decoder failure without creating a partial cache', async () => {
    execFile.mockImplementationOnce((_command, _args, _options, callback) => {
      callback(new Error('decoder failed'));
      return {};
    });
    await expect(createInsvThumbnail(makePair(), cache)).rejects.toThrow(
      'Unable to create the INSV panorama thumbnail'
    );
    expect(fs.readdirSync(cache)).toEqual([]);
  });

  test('discards the thumbnail if either original changes during generation', async () => {
    const pair = makePair();
    const ffmpeg = execFile.getMockImplementation();
    execFile.mockImplementation((...args) => {
      if (args[1].includes('pipe:0')) fs.appendFileSync(files[1], 'changed');
      return ffmpeg(...args);
    });
    await expect(createInsvThumbnail(pair, cache)).rejects.toThrow(/changed/);
    expect(fs.readdirSync(cache)).toEqual([]);
  });
});
