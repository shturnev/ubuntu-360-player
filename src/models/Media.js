const fs = require('fs');
const path = require('path');
const os = require('os');
const { exec } = require('child_process');
const gm = require('gm');

const getStorageRoot = () => {
  const base = process.env.SHT_VR_HOME || process.env.HOME || os.homedir();
  return path.join(base, '.sht-vr-player');
};

class Media {
  static saveImage(filePath, win) {
    const newFileName = getNewFileName(filePath);
    createLink(filePath, newFileName);

    const thumpName = newFileName;
    const thumpPath = path.join(getStorageRoot(), 'static', 'small', thumpName);
    const res = {
      error: null,
      type: 'image',
      origPath: filePath,
      thumpName,
      bigName: newFileName
    };

    try {
      fs.statSync(thumpPath);
      if (win && win.webContents) win.webContents.send('read-media-file', res);
      return res;
    } catch (e) {
      gm(filePath).resize(450).autoOrient().write(thumpPath, (err) => {
        if (err) {
          res.error = err;
        }
        if (win && win.webContents) win.webContents.send('read-media-file', res);
      });
      return res;
    }
  }

  static saveVideo(filePath, win) {
    const newFileName = getNewFileName(filePath);
    createLink(filePath, newFileName);

    const thumpName = path.parse(newFileName).name + '.jpg';
    const thumpPath = path.join(getStorageRoot(), 'static', 'small', thumpName);
    const res = {
      error: null,
      type: 'video',
      origPath: filePath,
      thumpName,
      bigName: newFileName
    };

    try {
      fs.statSync(thumpPath);
      if (win && win.webContents) win.webContents.send('read-media-file', res);
      return res;
    } catch (e) {
      exec(`ffmpeg -i ${filePath} -s 450x225 -vframes 1 ${thumpPath} -y`, (error, stdout, stderr) => {
        if (error) {
          res.error = error;
        }
        if (stderr && stderr.search('deprecated pixel format used') === -1) {
          res.error = { message: stderr };
        }
        if (win && win.webContents) win.webContents.send('read-media-file', res);
      });
      return res;
    }
  }
}

function createLink(origPath, newFileName) {
  const linksDir = path.join(getStorageRoot(), 'static', 'big');
  const linkPath = path.join(linksDir, newFileName);

  fs.mkdirSync(linksDir, { recursive: true });

  try {
    fs.statSync(linkPath);
    return;
  } catch (e) {
    fs.symlinkSync(origPath, linkPath);
  }
}

function getNewFileName(origPath) {
  const stats = fs.statSync(origPath);
  const parsed = path.parse(origPath);

  return parsed.name + '-' + stats.size + parsed.ext;
}

module.exports = { Media };
Object.defineProperty(module.exports, 'default', {
  value: Media,
  enumerable: false
});