const { autoUpdater } = require('electron-updater');

const RELEASES_URL = 'https://github.com/shturnev/ubuntu-360-player/releases/latest';

class Updater {
  constructor(client = autoUpdater) {
    this.client = client;
    this.send = null;
    this.initialized = false;
  }

  initialize(send) {
    if (this.initialized) return;

    this.send = send;
    this.client.autoDownload = false;
    this.client.autoInstallOnAppQuit = false;
    this.client.on('update-available', (info) => this.emit('update-available', this.serializeInfo(info)));
    this.client.on('download-progress', (progress) =>
      this.emit('update-download-progress', {
        percent: Math.round(Number(progress.percent) || 0),
        bytesPerSecond: Number(progress.bytesPerSecond) || 0,
        transferred: Number(progress.transferred) || 0,
        total: Number(progress.total) || 0,
      })
    );
    this.client.on('update-downloaded', (info) => this.emit('update-downloaded', this.serializeInfo(info)));
    this.client.on('error', (error) =>
      this.emit('update-error', {
        message: error && error.message ? error.message : 'Unable to update the application.',
      })
    );
    this.initialized = true;
  }

  async check(configData) {
    if (!configData || !configData.checkUpdates) return false;
    return this.client.checkForUpdates();
  }

  async download() {
    return this.client.downloadUpdate();
  }

  install() {
    this.client.quitAndInstall();
  }

  emit(channel, payload) {
    if (this.send) this.send(channel, payload);
  }

  serializeInfo(info = {}) {
    return {
      version: info.version || '',
      releaseNotes: typeof info.releaseNotes === 'string' ? info.releaseNotes : '',
      releaseUrl: RELEASES_URL,
    };
  }
}

module.exports = Updater;
Object.defineProperty(module.exports, 'default', {
  value: Updater,
  enumerable: false,
});
