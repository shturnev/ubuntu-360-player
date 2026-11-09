const request = require('request');
const querystring = require('querystring');
const api_url = "https://upfiler.sht-server.cf/api/";


class Updater {

  /**
   * Check for updates
   *
   * @param configData- {version, checkUpdates, albumId}
   * @return Promise (false or objectData)
   */
  static async check(configData){
    if(!configData.checkUpdates){return false;}


    let forSend = {
      "action": "file_get_last_in_album",
      "album_hash": configData.albumId
    };

    let resData = await new Promise((resolve, reject) => {
      request.post({
        headers: {'content-type' : 'application/x-www-form-urlencoded'},
        url:     api_url,
        body:    querystring.stringify(forSend)
      }, function(error, response, body){
        if(error){ reject(error); return; }
        let res = JSON.parse(body);
        if(res.error_desc){ reject(res.error_desc); return; }
        resolve(res.data);
      });
    });

    let serverVersion = resData.filename_orig.split("_")[1];
    if(configData.version === serverVersion){return false;}
    return resData;
  }
}

export default Updater;
