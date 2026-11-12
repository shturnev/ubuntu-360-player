const fs = require('fs');
const baseConfig = require('../../project.config');
const { getStorageRoot } = require('../config/env');
const homePath = getStorageRoot();
const legacyUpdateKeys = new Set(['albumId', 'downloadLink']);

class ConfigModel {
  constructor() {
    if (!homePath) throw new Error('No home path specified');
    this.configPath = homePath + '/config.json';
  }

  loadSettings(settingsObj) {
    if (!settingsObj) return true;
    if (!this.configPath) {
      throw new Error('Could not store the settings. Config path did not specified');
    }

    const serializableSettings = Object.fromEntries(
      Object.entries(settingsObj).filter(
        ([key]) => key !== 'default' && key !== '__esModule' && !legacyUpdateKeys.has(key)
      )
    );
    const serializable = { ...serializableSettings, version: baseConfig.version };
    fs.writeFileSync(this.configPath, JSON.stringify(serializable));
    return true;
  }

  getSettings() {
    if (!fs.existsSync(this.configPath)) {
      this.loadSettings(baseConfig);
      return { ...baseConfig };
    }

    let data = fs.readFileSync(this.configPath, 'utf8');
    data = JSON.parse(data);
    const containsLegacyUpdateConfig = Object.keys(data).some((key) => legacyUpdateKeys.has(key));
    data = Object.fromEntries(Object.entries(data).filter(([key]) => !legacyUpdateKeys.has(key)));

    if (data.version !== baseConfig.version || containsLegacyUpdateConfig) {
      data = { ...baseConfig, ...data, version: baseConfig.version };
      this.loadSettings(data);
    }

    return data;
  }
}

module.exports = ConfigModel;
Object.defineProperty(module.exports, 'default', {
  value: ConfigModel,
  enumerable: false,
});
