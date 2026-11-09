import da from "quasar/lang/da";

const fs = require("fs");
import baseConfig from "../../project.config";
const homePath = require('os').homedir() + '/.sht-vr-player';
import _ from 'lodash';

class ConfigModel {

  constructor() {
    if(!homePath){throw new Error("No home path specified")}
    this.configPath = homePath + "/config.json";
  }

  /**
   * Save (load) settings into file
   *
   * @param  settingsObj - data (object) for save
   */
  loadSettings(settingsObj){
    if(!settingsObj){ return true; }
    if (!this.configPath){throw new Error("Could not store the settings. Config path did not specified")}

    //write to file
    let res = fs.writeFileSync(this.configPath, JSON.stringify(settingsObj));
    return res === undefined
  }

  /**
   * Get settings from file, if not exists then global
   */
  getSettings(){
    if(!fs.existsSync(this.configPath)){
      this.loadSettings(baseConfig, );
      return baseConfig;
    }

    let data = fs.readFileSync(this.configPath, 'utf8');
    data = JSON.parse(data);

    //update old settings (after installing updated version)
    if(data.version !== baseConfig.version){
      data.version = baseConfig.version;
      data = _.merge(data, baseConfig);
      this.loadSettings(data);
    }

    return data;
  }

}

export default ConfigModel;
