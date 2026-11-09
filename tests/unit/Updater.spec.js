import Updater from "../../src/models/Updater";
import BaseConfig from '../../project.config'
import _ from 'lodash'

describe('Updater class', ()=>{

  test('check for new version', ()=>{

    return Updater.check(BaseConfig).then(res => {
      if(_.isBoolean(res)){
        expect(res).toBeFalsy(res);
        return;
      }
      expect(res).toHaveProperty('filename_orig');
      console.log(res);
    }).catch(err => {
      console.log(err);
      expect(err).toHaveProperty('message');
    });
  })

});
