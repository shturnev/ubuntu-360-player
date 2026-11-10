const fs = require('fs');

class Helper {
  static checkDir(inputPath) {
    try {
      fs.statSync(inputPath);
    } catch (e) {
      fs.mkdirSync(inputPath, {
        mode: 0o700,
        recursive: true
      });
    }

    return 1;
  }

  static isFileExists(inputPath) {
    try {
      fs.statSync(inputPath);
      return true;
    } catch (e) {
      return false;
    }
  }
}

module.exports = { Helper };
Object.defineProperty(module.exports, 'default', {
  value: Helper,
  enumerable: false
});