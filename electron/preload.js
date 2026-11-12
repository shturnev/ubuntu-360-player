const { contextBridge, ipcRenderer } = require('electron');

const allowedChannels = [
  'open-dir',
  'delete-selected',
  'delete-cache',
  'get-cache-size',
  'get-config',
  'save-config',
  'check-for-update',
  'download-update',
  'install-update',
  'get-server-url',
  'start-file-server',
  'config-data',
  'start-read-dir',
  'read-media-file',
  'file-deleted',
  'delete-error',
  'delete-cache-finish',
  'show-error',
  'update-available',
  'update-download-progress',
  'update-downloaded',
  'update-error',
  'cache-size',
  'convert-video',
  'video-conversion-progress',
  'video-conversion-result',
];

contextBridge.exposeInMainWorld('shtVR', {
  send(channel, payload) {
    if (allowedChannels.includes(channel)) {
      ipcRenderer.send(channel, payload);
    }
  },
  on(channel, listener) {
    if (allowedChannels.includes(channel)) {
      ipcRenderer.on(channel, listener);
      return () => ipcRenderer.removeListener(channel, listener);
    }
    return () => {};
  },
  removeListener(channel, listener) {
    if (allowedChannels.includes(channel)) {
      ipcRenderer.removeListener(channel, listener);
    }
  },
  async openExternal(url) {
    return ipcRenderer.invoke('open-external-url', url);
  },
});
