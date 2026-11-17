const fs = require('fs');
const os = require('os');
const path = require('path');

jest.mock('../../src/models/insvMotion', () => ({ prepareInsvMotion: jest.fn() }));
const { prepareInsvMotion } = require('../../src/models/insvMotion');
const { getCachedInsvMotion } = require('../../src/models/insvMotionCache');

describe('INSV stabilization cache', () => {
  let directory;
  let files;
  let cacheDir;
  const motion = {
    mode: 'gyro',
    frames: [
      { time: 0, rotation: [0, 0, 0, 1] },
      { time: 1, rotation: [0, 0, 1, 0] },
    ],
    warning: '',
  };
  const makePair = () => ({
    paths: files,
    snapshots: files.map((file) => {
      const { dev, ino, size, mtimeMs, ctimeMs } = fs.statSync(file);
      return { dev, ino, size, mtimeMs, ctimeMs };
    }),
    video: { fps: 30, duration: 2 },
  });

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'insv-motion-cache-'));
    cacheDir = path.join(directory, 'cache');
    files = [path.join(directory, '00.insv'), path.join(directory, '10.insv')];
    files.forEach((file) => fs.writeFileSync(file, 'original'));
    prepareInsvMotion.mockReset().mockResolvedValue(motion);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  test('reuses the persisted track for the unchanged pair and recomputes when either file changes', async () => {
    const first = makePair();
    const onCacheMiss = jest.fn();
    expect(await getCachedInsvMotion(first, cacheDir, { onCacheMiss })).toEqual(motion);
    expect(await getCachedInsvMotion(first, cacheDir, { onCacheMiss })).toEqual(motion);
    expect(prepareInsvMotion).toHaveBeenCalledTimes(1);
    expect(onCacheMiss).toHaveBeenCalledTimes(1);
    expect(fs.readdirSync(cacheDir)).toHaveLength(1);
    expect(fs.statSync(cacheDir).mode & 0o777).toBe(0o700);
    expect(fs.statSync(path.join(cacheDir, fs.readdirSync(cacheDir)[0])).mode & 0o777).toBe(0o600);
    fs.appendFileSync(files[1], 'changed');
    await expect(getCachedInsvMotion(first, cacheDir)).rejects.toThrow(/changed/);
    expect(await getCachedInsvMotion(makePair(), cacheDir)).toEqual(motion);
    expect(prepareInsvMotion).toHaveBeenCalledTimes(2);
  });

  test('recalculates corrupted or incomplete cached tracks', async () => {
    const pair = makePair();
    await getCachedInsvMotion(pair, cacheDir);
    const cache = path.join(cacheDir, fs.readdirSync(cacheDir)[0]);
    fs.writeFileSync(cache, '{"version":1}');
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await getCachedInsvMotion(pair, cacheDir)).toEqual(motion);
    expect(prepareInsvMotion).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalled();
    expect(await getCachedInsvMotion(pair, cacheDir)).toEqual(motion);
    expect(prepareInsvMotion).toHaveBeenCalledTimes(2);
  });

  test.each([
    { mode: 'horizon', frames: [{ time: 0, rotation: [0, 0, 0, 1] }], warning: 'Horizon only.' },
    { mode: 'none', frames: [], warning: 'Correction unavailable.' },
  ])('reuses deterministic fallback mode $mode with its warning', async (fallback) => {
    prepareInsvMotion.mockResolvedValue(fallback);
    const pair = makePair();
    expect(await getCachedInsvMotion(pair, cacheDir)).toEqual(fallback);
    expect(await getCachedInsvMotion(pair, cacheDir)).toEqual(fallback);
    expect(prepareInsvMotion).toHaveBeenCalledTimes(1);
  });

  test('does not cache a fallback caused by a transient tool failure', async () => {
    const fallback = { mode: 'none', frames: [], warning: 'Motion data could not be read.' };
    prepareInsvMotion.mockImplementation(async (_pair, options) => {
      options.onTransientFailure();
      return fallback;
    });
    const pair = makePair();
    expect(await getCachedInsvMotion(pair, cacheDir)).toEqual(fallback);
    expect(await getCachedInsvMotion(pair, cacheDir)).toEqual(fallback);
    expect(prepareInsvMotion).toHaveBeenCalledTimes(2);
    expect(fs.existsSync(cacheDir)).toBe(false);
  });

  test('does not persist results from a cancelled import', async () => {
    let active = true;
    prepareInsvMotion.mockImplementation(async () => {
      active = false;
      return motion;
    });
    await expect(getCachedInsvMotion(makePair(), cacheDir, { isCurrent: () => active })).rejects.toThrow(/cancelled/);
    expect(fs.existsSync(cacheDir)).toBe(false);
  });

  test('reports cache write failures explicitly', async () => {
    jest.spyOn(fs.promises, 'writeFile').mockRejectedValue(Object.assign(new Error('disk full'), { code: 'ENOSPC' }));
    await expect(getCachedInsvMotion(makePair(), cacheDir)).rejects.toThrow(
      'Unable to write the INSV stabilization cache. Check disk space and permissions.'
    );
  });
});
