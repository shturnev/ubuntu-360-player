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
});
