// import test from 'jest'
import {Helper} from '@/models/Helper';

const os = require('os');
const homeDir = os.homedir();


describe('Helper class', ()=> {

  test('check for dir creating', () =>{
    let path = homeDir + '/YYYYYYYYYYYY';
    expect(Helper.checkDir(path)).toBe(1)
  })

})
