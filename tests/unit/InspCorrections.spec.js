const fs = require('fs');
const os = require('os');
const path = require('path');
const { InspCorrections, inspIdentity } = require('../../src/models/inspCorrections');

describe('INSP corrections', () => {
  let directory;
  let store;

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'insp-corrections-'));
    store = new InspCorrections(path.join(directory, 'corrections.json'));
  });

  afterEach(() => fs.rmSync(directory, { recursive: true, force: true }));

  test('persists overrides and orientation for a source snapshot', () => {
    const snapshot = { size: 20, mtimeMs: 1 };
    const key = inspIdentity('/a/file.INSP', snapshot);
    const correction = { override: 205.5, rotations: [{ yaw: 10, pitch: -5, roll: 0 }] };
    store.set(key, correction);
    expect(new InspCorrections(store.filePath).get(key)).toEqual(correction);
    expect(store.get(inspIdentity('/b/file.INSP', snapshot))).toBeUndefined();
    expect(store.get(inspIdentity('/a/file.INSP', { ...snapshot, mtimeMs: 2 }))).toBeUndefined();
    store.set(key, { ...correction, override: null });
    expect(store.get(key)).toEqual({ ...correction, override: null });
  });

  test('rejects invalid and corrupted corrections rather than silently dropping them', () => {
    const key = inspIdentity('/a/file.insp', {});
    expect(() => store.set(key, { override: 200.01, rotations: [] })).toThrow(/invalid/i);
    expect(() => store.set(key, { override: null, rotations: [{ yaw: Infinity, pitch: 0, roll: 0 }] })).toThrow(
      /invalid/i
    );
    fs.writeFileSync(store.filePath, '{"version":1,"entries":{"broken":{}}}');
    expect(() => store.get(key)).toThrow(/corrupted/i);
  });

  test('preserves the previous correction when an atomic replacement fails', () => {
    const key = inspIdentity('/a/file.insp', {});
    const previous = { override: 200, rotations: [{ yaw: 2, pitch: 0, roll: 0 }] };
    store.set(key, previous);
    const rename = jest.spyOn(fs, 'renameSync').mockImplementation(() => {
      throw new Error('disk error');
    });
    try {
      expect(() => store.set(key, { override: 210, rotations: [] })).toThrow(/disk error/i);
      expect(store.get(key)).toEqual(previous);
      expect(fs.readdirSync(directory)).toEqual(['corrections.json']);
    } finally {
      rename.mockRestore();
    }
  });
});
