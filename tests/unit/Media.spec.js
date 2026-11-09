// import test from 'jest'
import {Helper} from '@/models/Helper';
import {Media} from "../../src/models/Media";

const os = require('os');
const homeDir = os.homedir() + "/.sht-vr-player/static/";


describe('Media class', ()=> {

  test('Save video', () =>{
    //для начала подготовим необходимые папки
    let origPath = '/home/shturnev/Видео/Pool-12-09.mp4';
    Helper.checkDir(homeDir + '/big');
    Helper.checkDir(homeDir + '/small');


    expect(Media.saveVideo(origPath)).toBe(1)
  })

})
