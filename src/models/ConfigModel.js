const fs = require('fs');
const _ = require('lodash');
const baseConfig = require('../../project.config');
const { getStorageRoot } = require('../config/env');
const homePath = getStorageRoot();

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

    const serializable = Object.fromEntries(
      Object.entries(settingsObj).filter(([key]) => key !== 'default' && key !== '__esModule')
    );
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

    if (data.version !== baseConfig.version) {
      data.version = baseConfig.version;
      data = _.merge({}, baseConfig, data);
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
