const fs = require('fs');
const crypto = require('crypto');
const baseConfig = require('../../project.config');
const { getStorageRoot } = require('../config/env');
const { isValidLensFov } = require('./lensFov');
const { renameSyncWithRetry } = require('./fsRetry');
const homePath = getStorageRoot();
const legacyUpdateKeys = new Set(['albumId', 'downloadLink']);
const lensFovKeys = ['inspLensFov', 'insvLensFov'];

function validateLensSettings(settings) {
  for (const key of lensFovKeys) {
    if (Object.hasOwn(settings, key) && !isValidLensFov(settings[key])) {
      throw new Error(`Invalid ${key}: lens field of view must be between 180 and 220 degrees in 0.1 degree steps.`);
    }
  }
}

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
    validateLensSettings(settingsObj);

    const serializableSettings = Object.fromEntries(
      Object.entries(settingsObj).filter(
        ([key]) => key !== 'default' && key !== '__esModule' && !legacyUpdateKeys.has(key)
      )
    );
    const serializable = { ...serializableSettings, version: baseConfig.version };
    const temporary = `${this.configPath}.${crypto.randomUUID()}.tmp`;
    let created = false;
    let fd;
    try {
      fd = fs.openSync(temporary, 'wx', 0o600);
      created = true;
      fs.writeFileSync(fd, JSON.stringify(serializable));
      fs.closeSync(fd);
      fd = undefined;
      renameSyncWithRetry(temporary, this.configPath);
      created = false;
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
      if (created) fs.unlinkSync(temporary);
    }
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
    validateLensSettings(data);

    const missingDefaults = Object.keys(baseConfig).some((key) => !Object.hasOwn(data, key));
    if (data.version !== baseConfig.version || containsLegacyUpdateConfig || missingDefaults) {
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
