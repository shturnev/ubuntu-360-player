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
