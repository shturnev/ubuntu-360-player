const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');

jest.mock('exifr', () => ({ parse: jest.fn().mockResolvedValue(null) }));
jest.mock('../../src/models/mediaTools', () => jest.requireActual('./linuxTools'));
jest.mock('gm', () =>
  jest.fn(() => ({
    resize() {
      return this;
    },
    autoOrient() {
      return this;
    },
    write(file, callback) {
      require('fs').writeFileSync(file, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
      callback(null);
    },
  }))
);
jest.mock('child_process', () => ({
  execFile: jest.fn((_command, _args, callback) => callback(null, '', '')),
  spawn: jest.fn(),
}));

const { spawn, execFile } = require('child_process');
const { Media } = require('../../src/models/Media');
const { snapshotInsp } = require('../../src/models/inspSource');

describe('INSP lens rendering', () => {
  let directory;
  let source;
  let originalHome;

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'insp-render-'));
    source = path.join(directory, 'source.INSP');
    fs.writeFileSync(source, 'original');
    originalHome = process.env.SHT_VR_HOME;
    process.env.SHT_VR_HOME = directory;
    spawn.mockImplementation((_command, args) => {
      const child = new EventEmitter();
      child.stderr = new EventEmitter();
      child.kill = jest.fn();
      setTimeout(() => {
        fs.writeFileSync(args.at(-1), Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
        child.emit('close', 0);
      }, 0);
      return child;
    });
  });

  afterEach(() => {
    if (originalHome === undefined) delete process.env.SHT_VR_HOME;
    else process.env.SHT_VR_HOME = originalHome;
    fs.rmSync(directory, { recursive: true, force: true });
    jest.clearAllMocks();
  });

  test('keys complete caches by FOV, original and saved orientations', async () => {
    const snapshot = snapshotInsp(source);
    const options = { snapshot, fieldOfView: 199, rotations: [], isCurrent: () => true };
    const baseline = await Media.renderInsta360Image(source, options);
    const big = path.join(directory, '.sht-vr-player', 'static', 'big', baseline.bigName);
    const small = path.join(directory, '.sht-vr-player', 'static', 'small', baseline.thumpName);
    expect(fs.existsSync(big)).toBe(true);
    expect(fs.existsSync(small)).toBe(true);
    expect(spawn.mock.calls[0][1].join(' ')).toContain('ih_fov=199:iv_fov=199');
    expect(execFile).toHaveBeenCalledWith(
      'perl',
      expect.arrayContaining(['-TagsFromFile', source, '-EXIF']),
      expect.any(Function)
    );
    spawn.mockClear();
    expect(await Media.renderInsta360Image(source, options)).toEqual(baseline);
    expect(spawn).not.toHaveBeenCalled();

    const adjusted = await Media.renderInsta360Image(source, { ...options, fieldOfView: 210 });
    expect(adjusted.bigName).not.toBe(baseline.bigName);
    expect(spawn.mock.calls[0][1].join(' ')).toContain('ih_fov=210:iv_fov=210');
    const rotated = await Media.renderInsta360Image(source, {
      ...options,
      rotations: [{ yaw: 10, pitch: 0, roll: 0 }],
    });
    expect(rotated.bigName).not.toBe(baseline.bigName);
    expect(fs.readFileSync(source, 'utf8')).toBe('original');
  });

  test('does not publish cache files when the source changes during rendering', async () => {
    const snapshot = snapshotInsp(source);
    spawn.mockImplementation((_command, args) => {
      const child = new EventEmitter();
      child.stderr = new EventEmitter();
      child.kill = jest.fn();
      setTimeout(() => {
        fs.writeFileSync(args.at(-1), Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
        fs.appendFileSync(source, 'changed');
        child.emit('close', 0);
      }, 0);
      return child;
    });
    await expect(
      Media.renderInsta360Image(source, { snapshot, fieldOfView: 199, rotations: [], isCurrent: () => true })
    ).rejects.toThrow(/changed/i);
    const root = path.join(directory, '.sht-vr-player', 'static');
    expect(fs.readdirSync(path.join(root, 'big'))).toEqual([]);
    expect(fs.readdirSync(path.join(root, 'small'))).toEqual([]);
  });
});
