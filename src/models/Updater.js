const querystring = require('querystring');

const apiUrl = 'https://upfiler.sht-server.cf/api/';

class Updater {
  static async check(configData) {
    if (!configData || !configData.checkUpdates) return false;

    const forSend = {
      action: 'file_get_last_in_album',
      album_hash: configData.albumId
    };

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: querystring.stringify(forSend),
      redirect: 'error'
    });
    const body = await response.text();
    const res = JSON.parse(body || '{}');
    if (res && res.error_desc) {
      throw new Error(res.error_desc);
    }
    const resData = res && res.data ? res.data : false;

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
