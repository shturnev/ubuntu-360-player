const path = require('path');

const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
const MAX_STEM = 200;

// Builds an export file name that is valid on Windows; other platforms keep the name as is.
function exportFileName(origPath, extension, platform = process.platform) {
  const stem = (platform === 'win32' ? path.win32 : path).parse(origPath).name;
  if (platform !== 'win32') return `${stem}${extension}`;
  let safe = stem
    // eslint-disable-next-line no-control-regex
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
    .replace(/[. ]+$/, '')
    .slice(0, MAX_STEM)
    .replace(/[. ]+$/, '');
  if (!safe) safe = 'media';
  if (RESERVED.test(safe)) safe = `_${safe}`;
  return `${safe}${extension}`;
}

module.exports = { exportFileName };
