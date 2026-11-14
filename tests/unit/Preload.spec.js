jest.mock('electron', () => {
  const { EventEmitter: MockEventEmitter } = require('events');
  return {
    contextBridge: { exposeInMainWorld: jest.fn() },
    ipcRenderer: Object.assign(new MockEventEmitter(), { invoke: jest.fn() }),
  };
});

const { contextBridge, ipcRenderer } = require('electron');
require('../../electron/preload');

describe('preload IPC listener lifecycle', () => {
  let api;

  beforeEach(() => {
    api = contextBridge.exposeInMainWorld.mock.calls[0][1];
    ipcRenderer.removeAllListeners();
  });

  test('removing and re-registering a listener leaves only one callback', () => {
    const listener = jest.fn();

    const unsubscribe = api.on('read-media-file', listener);
    unsubscribe();
    api.on('read-media-file', listener);
    ipcRenderer.emit('read-media-file', {}, { origPath: '/media/first.jpg' });
    ipcRenderer.emit('read-media-file', {}, { origPath: '/media/second.jpg' });

    expect(listener).toHaveBeenCalledTimes(2);
    expect(listener).toHaveBeenNthCalledWith(1, {}, { origPath: '/media/first.jpg' });
    expect(listener).toHaveBeenNthCalledWith(2, {}, { origPath: '/media/second.jpg' });
  });

  test('allows metadata response events but blocks unknown channels', () => {
    const listener = jest.fn();

    api.on('media-metadata', listener);
    api.on('not-allowed', listener);
    ipcRenderer.emit('media-metadata', {}, { origPath: '/media/photo.jpg', entries: [] });
    ipcRenderer.emit('not-allowed', {}, {});

    expect(listener).toHaveBeenCalledTimes(1);
  });

  test('uses only the dedicated invoke channel to save panorama screenshots', async () => {
    const data = new ArrayBuffer(4);
    ipcRenderer.invoke.mockResolvedValue({ success: true });

    await expect(api.savePanoramaScreenshot({ data })).resolves.toEqual({ success: true });

    expect(ipcRenderer.invoke).toHaveBeenCalledWith('save-panorama-screenshot', { data });
  });
});
