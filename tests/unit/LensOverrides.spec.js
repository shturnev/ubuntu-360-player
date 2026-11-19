const fs = require('fs');
const os = require('os');
const path = require('path');
const { LensOverrides, insvIdentity } = require('../../src/models/lensOverrides');

describe('lens overrides', () => {
  let directory;
  let store;
  let paths;

  const pair = () => ({
    paths,
    snapshots: paths.map((file) => {
      const { dev, ino, size, mtimeMs, ctimeMs } = fs.statSync(file);
      return { dev, ino, size, mtimeMs, ctimeMs };
    }),
  });

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lens-overrides-'));
    paths = [path.join(directory, '00.insv'), path.join(directory, '10.insv')];
    paths.forEach((file) => fs.writeFileSync(file, 'lens'));
    store = new LensOverrides(path.join(directory, 'lens-overrides.json'));
  });

  afterEach(() => {
    fs.rmSync(directory, { recursive: true, force: true });
    jest.restoreAllMocks();
  });

  test('persists and resets an override independently of cache files', () => {
    const key = insvIdentity(pair());
    expect(store.get(key)).toBeUndefined();
    store.set(key, 200.2);
    expect(new LensOverrides(store.filePath).get(key)).toBe(200.2);
    store.set(key, null);
    expect(store.get(key)).toBeUndefined();
  });

  test('treats a moved or modified original as a different pair', () => {
    const original = insvIdentity(pair());
    store.set(original, 200);
    fs.appendFileSync(paths[1], 'changed');
    expect(store.get(insvIdentity(pair()))).toBeUndefined();
    const moved = path.join(directory, 'moved.insv');
    fs.renameSync(paths[0], moved);
    paths[0] = moved;
    expect(store.get(insvIdentity(pair()))).toBeUndefined();
  });

  test('reports corrupted and invalid records', () => {
    fs.writeFileSync(store.filePath, '{"version":1,"entries":{"broken":200}}');
    expect(() => store.get(insvIdentity(pair()))).toThrow(/corrupted/);
    expect(() => store.set(insvIdentity(pair()), 200)).toThrow(/corrupted/);
    expect(() => store.set(insvIdentity(pair()), 200.01)).toThrow(/invalid/i);
  });

  test('keeps the previous file when replacement fails', () => {
    const key = insvIdentity(pair());
    store.set(key, 200);
    jest.spyOn(fs, 'renameSync').mockImplementationOnce(() => {
      throw new Error('storage unavailable');
    });
    expect(() => store.set(key, 205)).toThrow(/storage unavailable/);
    expect(store.get(key)).toBe(200);
    expect(fs.readdirSync(directory).filter((file) => file.endsWith('.tmp'))).toEqual([]);
  });
});
