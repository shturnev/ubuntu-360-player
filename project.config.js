/**
 * Default settings for project
 */

const { version } = require('./package.json');

const baseConfig = {
  version,
  checkUpdates: true,
  inspLensFov: 199,
  insvLensFov: 183.3,
};

module.exports = baseConfig;
Object.defineProperty(module.exports, '__esModule', { value: true });
Object.defineProperty(module.exports, 'default', {
  value: baseConfig,
  enumerable: false,
});
