import fs from 'fs'


export class Helper {
  static checkDir(path){
    try {
      fs.statSync(path);
      // fs.chmodSync(path, 0o700)
    } catch(e) {
      fs.mkdirSync(path, {
        mode: 0o700,
        recursive: true
      });
    }

    return true
  }

  static isFileExists(path){
    let status = false;

    try {
      fs.statSync(path);
      status = true;
    } catch(e) {
      //status = false
    }

    return status;
  }

}