const fs = require('fs');
const os = require('os');
const path = require('path');

const ConfigModel = require('../../src/models/ConfigModel');
const baseConfig = require('../../project.config');

describe('ConfigModel', () => {
  let tempDir;
  let configModel;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sht-vr-config-'));
    process.env.SHT_VR_HOME = tempDir;
    configModel = new ConfigModel();
    configModel.configPath = path.join(tempDir, 'config.json');
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    delete process.env.SHT_VR_HOME;
  });

  test('loads and stores settings in a temp directory', () => {
    const result = configModel.loadSettings(baseConfig);
    expect(result).toBe(true);
    expect(fs.existsSync(configModel.configPath)).toBe(true);

    const settings = configModel.getSettings();
    expect(settings).toHaveProperty('version', baseConfig.version);
    expect(settings).toHaveProperty('checkUpdates', baseConfig.checkUpdates);
  });

  test('creates a missing config with the package-backed version', () => {
    const settings = configModel.getSettings();
    const stored = JSON.parse(fs.readFileSync(configModel.configPath, 'utf8'));

    expect(settings.version).toBe(require('../../package.json').version);
    expect(stored.version).toBe(require('../../package.json').version);
  });

  test('adds lens defaults to an existing config even when the version matches', () => {
    fs.writeFileSync(configModel.configPath, JSON.stringify({ version: baseConfig.version, checkUpdates: false }));

    const settings = configModel.getSettings();
    expect(settings).toMatchObject({ checkUpdates: false, inspLensFov: 199, insvLensFov: 183.3 });
    expect(JSON.parse(fs.readFileSync(configModel.configPath, 'utf8'))).toEqual(settings);
  });

  test('preserves saved lens defaults during migration', () => {
    fs.writeFileSync(
      configModel.configPath,
      JSON.stringify({ version: '0.0.1', inspLensFov: 201, insvLensFov: 185.2 })
    );

    expect(configModel.getSettings()).toMatchObject({ inspLensFov: 201, insvLensFov: 185.2 });
  });

  test.each([NaN, Infinity, '199', 179.9, 220.1, 199.01, null])('rejects invalid lens FOV %s', (value) => {
    expect(() => configModel.loadSettings({ ...baseConfig, inspLensFov: value })).toThrow(/invalid inspLensFov/i);
    expect(fs.existsSync(configModel.configPath)).toBe(false);
  });

  test('reports invalid stored lens settings rather than silently replacing them', () => {
    fs.writeFileSync(configModel.configPath, JSON.stringify({ ...baseConfig, insvLensFov: 0 }));
    expect(() => configModel.getSettings()).toThrow(/invalid insvLensFov/i);
  });

  test('keeps the previous config if the atomic replacement fails', () => {
    configModel.loadSettings(baseConfig);
    const previous = fs.readFileSync(configModel.configPath, 'utf8');
    const rename = jest.spyOn(fs, 'renameSync').mockImplementationOnce(() => {
      throw new Error('disk error');
    });
    expect(() => configModel.loadSettings({ ...baseConfig, insvLensFov: 200 })).toThrow('disk error');
    rename.mockRestore();
    expect(fs.readFileSync(configModel.configPath, 'utf8')).toBe(previous);
    expect(fs.readdirSync(tempDir)).toEqual(['config.json']);
  });

  test('migrates the version and removes legacy updater settings while preserving user settings', () => {
    const legacySettings = {
      version: '0.0.1',
      checkUpdates: false,
      downloadLink: 'https://downloads.example/release',
      albumId: 'legacy-album',
      customSetting: 'keep me',
    };
    fs.writeFileSync(configModel.configPath, JSON.stringify(legacySettings));

    const settings = configModel.getSettings();
    const stored = JSON.parse(fs.readFileSync(configModel.configPath, 'utf8'));

    expect(settings).toEqual({
      ...baseConfig,
      version: baseConfig.version,
      checkUpdates: false,
      customSetting: 'keep me',
    });
    expect(stored).toEqual(settings);
    expect(stored.version).toBe(baseConfig.version);
    expect(stored.checkUpdates).toBe(false);
    expect(stored.customSetting).toBe('keep me');
    expect(stored).not.toHaveProperty('downloadLink');
    expect(stored).not.toHaveProperty('albumId');
  });
});
