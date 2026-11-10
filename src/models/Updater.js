const request = require('request');
const querystring = require('querystring');

const apiUrl = 'https://upfiler.sht-server.cf/api/';

class Updater {
  static async check(configData) {
    if (!configData || !configData.checkUpdates) return false;

    const forSend = {
      action: 'file_get_last_in_album',
      album_hash: configData.albumId
    };

    const resData = await new Promise((resolve, reject) => {
      request.post({
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        url: apiUrl,
        body: querystring.stringify(forSend)
      }, (error, response, body) => {
        if (error) {
          reject(error);
          return;
        }

        try {
          const res = JSON.parse(body || '{}');
          if (res && res.error_desc) {
            reject(new Error(res.error_desc));
            return;
          }
          resolve(res && res.data ? res.data : false);
        } catch (parseError) {
          reject(parseError);
        }
      });
    });

    if (!resData || !resData.filename_orig) return false;
    const serverVersion = resData.filename_orig.split('_')[1];
    if (configData.version === serverVersion) return false;
    return resData;
  }
}

module.exports = Updater;
Object.defineProperty(module.exports, 'default', {
  value: Updater,
  enumerable: false
});
