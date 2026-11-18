const path = require('path');

/** Key for comparing/grouping paths: Windows paths are case-insensitive and accept both separators. */
function pathKey(file, platform = process.platform) {
  if (platform === 'win32') return path.win32.normalize(file).toLowerCase();
  return path.posix.normalize(file);
}

function isSamePath(a, b, platform = process.platform) {
  return typeof a === 'string' && typeof b === 'string' && pathKey(a, platform) === pathKey(b, platform);
}

module.exports = { isSamePath, pathKey };
