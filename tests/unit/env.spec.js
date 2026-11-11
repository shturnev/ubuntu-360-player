const os = require('os');
const path = require('path');

const { getCandidatePorts, getStorageRoot, normalizePort } = require('../../src/config/env');

describe('environment configuration', () => {
  const originalDevServerPort = process.env.DEV_SERVER_PORT;
  const originalShtVrHome = process.env.SHT_VR_HOME;

  afterEach(() => {
    if (originalDevServerPort === undefined) {
      delete process.env.DEV_SERVER_PORT;
    } else {
      process.env.DEV_SERVER_PORT = originalDevServerPort;
    }

    if (originalShtVrHome === undefined) {
      delete process.env.SHT_VR_HOME;
    } else {
      process.env.SHT_VR_HOME = originalShtVrHome;
    }
  });

  test('uses the default Vite port range when no env override is set', () => {
    delete process.env.DEV_SERVER_PORT;

    expect(normalizePort(process.env.DEV_SERVER_PORT)).toBe(5173);
    expect(getCandidatePorts(process.env.DEV_SERVER_PORT)).toEqual([5173, 5174, 5175, 5176, 5177]);
  });

  test('accepts a custom base port and keeps a five-port search window', () => {
    process.env.DEV_SERVER_PORT = '5185';

    expect(normalizePort(process.env.DEV_SERVER_PORT)).toBe(5185);
    expect(getCandidatePorts(process.env.DEV_SERVER_PORT)).toEqual([5185, 5186, 5187, 5188, 5189]);
  });

  test('throws a clear error for invalid port values', () => {
    expect(() => normalizePort('abc')).toThrow(/Invalid DEV_SERVER_PORT value/);
    expect(() => normalizePort(70000)).toThrow(/Invalid DEV_SERVER_PORT value/);
  });

  test('keeps SHT_VR_HOME semantics compatible with the app storage root', () => {
    const customRoot = path.join(os.tmpdir(), 'sht-vr-custom-root');
    process.env.SHT_VR_HOME = customRoot;

    expect(getStorageRoot()).toBe(path.join(customRoot, '.sht-vr-player'));

    delete process.env.SHT_VR_HOME;
    expect(getStorageRoot()).toBe(path.join(os.homedir(), '.sht-vr-player'));
  });
});
