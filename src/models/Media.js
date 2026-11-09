import fs from 'fs'
import path from 'path'
import {exec} from 'child_process'

const gm = require('gm');
const homedir = require('os').homedir() + '/.sht-vr-player';


export class Media {

  static saveImage(filePath, win) {
    let newFileName = getNewFileName(filePath);
    createLink(filePath, newFileName);

    //now we need check for existing thump
    let thumpName = newFileName,
      thumpPath = homedir + '/static/small/' + thumpName,
      res = {
        error: null,
        type: 'image',
        origPath: filePath,
        thumpName,
        bigName: newFileName
      };

    try {
      fs.statSync(thumpPath);
      win.webContents.send('read-media-file', res);
      console.log('image saved:');
      console.log(res);

    } catch (e) {

      gm(filePath).resize(450).autoOrient().write(thumpPath, (err) => {
        if (err) {
          res.error = err;
          console.log(err.message);
        }
        win.webContents.send('read-media-file', res);
        console.log('image saved:');
        console.log(res);
      });

    }
  }


  static saveVideo(filePath, win) {
    let newFileName = getNewFileName(filePath);
    createLink(filePath, newFileName);

    //now we need check for existing video thump
    let thumpName = path.parse(newFileName).name + '.jpg',
      thumpPath = homedir + '/static/small/' + thumpName,
      res = {
        error: null,
        type: 'video',
        origPath: filePath,
        thumpName,
        bigName: newFileName
      };

    try {

      fs.statSync(thumpPath);
      win.webContents.send('read-media-file', res)
      console.log('video saved:');
      console.log(res);

    } catch (e) {

      exec(`ffmpeg -i ${filePath} -s 450x225 -vframes 1 ${thumpPath} -y`, (error, stdout, stderr) => {
        if (error) {
          res.error = error
        }
        if (stderr && stderr.search('deprecated pixel format used') === -1) {
          res.error = {message: stderr}
        }
        win.webContents.send('read-media-file', res);
        console.log('video saved:');
        console.log(res);

      })

    }
  }

}

/*----------------------------------
Helpers
----------------------------------*/
function createLink(origPath, newFileName) {
  let linksDir = homedir + '/static/big',
    linkPath = linksDir + '/' + newFileName;

  try {
    fs.statSync(linkPath);
    return;
  } catch (e) {
    //else, create symbolic link
    fs.symlinkSync(origPath, linkPath)
  }

}

function getNewFileName(origPath) {

  let stats = fs.statSync(origPath),
    parsed = path.parse(origPath);

  return parsed.name + '-' + stats.size + parsed.ext;
}