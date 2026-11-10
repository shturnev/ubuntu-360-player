jest.mock('electron', () => {
  const { EventEmitter: MockEventEmitter } = require('events');
  return {
    contextBridge: { exposeInMainWorld: jest.fn() },
    ipcRenderer: new MockEventEmitter()
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
});
