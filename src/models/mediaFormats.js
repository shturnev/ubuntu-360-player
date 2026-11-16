const path = require('path');
const extensions = ['jpg', 'jpeg', 'png', 'insp', 'mp4'];

function isSupportedMediaPath(filePath) {
  return typeof filePath === 'string' && extensions.includes(path.extname(filePath).slice(1).toLowerCase());
}

module.exports = { extensions, isSupportedMediaPath };
