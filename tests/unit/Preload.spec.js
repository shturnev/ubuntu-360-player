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

  test('allows only the dedicated file import request and lifecycle events', () => {
    const listener = jest.fn();
    ipcRenderer.send = jest.fn();
    api.send('add-files');
    api.send('read-arbitrary-file', '/secret');
    api.on('start-read-files', listener);
    api.on('import-finished', listener);
    ipcRenderer.emit('start-read-files', {}, 2);
    ipcRenderer.emit('import-finished', {});
    expect(ipcRenderer.send).toHaveBeenCalledTimes(1);
    expect(ipcRenderer.send).toHaveBeenCalledWith('add-files', undefined);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  test('uses only the dedicated invoke channel to save panorama screenshots', async () => {
    const data = new ArrayBuffer(4);
    ipcRenderer.invoke.mockResolvedValue({ success: true });

    await expect(api.savePanoramaScreenshot({ data })).resolves.toEqual({ success: true });

    expect(ipcRenderer.invoke).toHaveBeenCalledWith('save-panorama-screenshot', { data });
  });

  test('uses the dedicated media export channel', async () => {
    ipcRenderer.invoke.mockResolvedValue({ success: true });
    await expect(api.saveCurrentMedia({ origPath: '/media/photo.jpg' })).resolves.toEqual({ success: true });
    expect(ipcRenderer.invoke).toHaveBeenCalledWith('save-current-media', { origPath: '/media/photo.jpg' });
  });

  test('uses only the dedicated selection export invoke channel', async () => {
    ipcRenderer.invoke.mockClear().mockResolvedValue({ success: true, saved: 1, errors: [] });
    ipcRenderer.send = jest.fn();
    const paths = ['/media/photo.jpg'];
    api.send('save-selected-media', paths);
    await expect(api.saveSelectedMedia(paths, 42)).resolves.toEqual({ success: true, saved: 1, errors: [] });
    expect(ipcRenderer.send).not.toHaveBeenCalled();
    expect(ipcRenderer.invoke).toHaveBeenCalledTimes(1);
    expect(ipcRenderer.invoke).toHaveBeenCalledWith('save-selected-media', paths, 42);
    const listener = jest.fn();
    const unsubscribe = api.on('export-progress', listener);
    ipcRenderer.emit('export-progress', {}, { requestId: 42, complete: 1, total: 2 });
    unsubscribe();
    ipcRenderer.emit('export-progress', {}, { requestId: 42, complete: 2, total: 2 });
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
