const fs = require('fs');
const path = require('path');
const { isSamePath } = require('./pathCompare');

function snapshotInsp(filePath) {
  if (typeof filePath !== 'string' || path.extname(filePath).toLowerCase() !== '.insp') {
    throw new Error('Invalid Insta360 photo source.');
  }
  const resolved = fs.realpathSync(filePath);
  const stat = fs.statSync(filePath);
  if (!isSamePath(resolved, filePath) || !stat.isFile()) {
    throw new Error('The Insta360 photo source is no longer available.');
  }
  return { dev: stat.dev, ino: stat.ino, size: stat.size, mtimeMs: stat.mtimeMs, ctimeMs: stat.ctimeMs };
}

function assertCurrentInsp(filePath, snapshot) {
  const current = snapshotInsp(filePath);
  if (Object.keys(current).some((key) => current[key] !== snapshot?.[key])) {
    throw new Error('The Insta360 photo source has changed.');
  }
}

module.exports = { snapshotInsp, assertCurrentInsp };
