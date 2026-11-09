import ConfigModel from "../../src/models/ConfigModel"
import {Media} from "../../src/models/Media";
import {MainModelClass} from "../../src/models/MainModelClass";
import baseConfig from "../../project.config";


describe('Config class', ()=> {

  const O = new ConfigModel();

  /**
   * Check is config file exists and if is not create it, another say true
   */
  test('Load settings', () =>{
    let res = O.loadSettings(baseConfig);
    expect(res).toBeTruthy();
  });


  /**
   * Get settings
   */
  test('Get settings', () =>{
    let settings = O.getSettings();
    expect(settings).toHaveProperty('version');
  })


})
