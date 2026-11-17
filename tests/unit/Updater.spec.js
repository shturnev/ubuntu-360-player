const { EventEmitter } = require('events');

jest.mock('electron-updater', () => ({
  autoUpdater: {},
  DebUpdater: class DebUpdater extends require('events').EventEmitter {},
}));

const Updater = require('../../src/models/Updater');
const { DebUpdater } = require('electron-updater');

describe('Updater', () => {
  let client;
  let updater;
  let send;

  beforeEach(() => {
    client = Object.assign(new EventEmitter(), {
      autoDownload: true,
      autoInstallOnAppQuit: true,
      checkForUpdates: jest.fn().mockResolvedValue(undefined),
      downloadUpdate: jest.fn().mockResolvedValue(undefined),
      quitAndInstall: jest.fn(),
    });
    updater = new Updater(client, 'linux', { APPIMAGE: '/tmp/360-media-viewer.AppImage' });
    send = jest.fn();
    updater.initialize(send);
  });

  test('does not check when automatic updates are disabled', async () => {
    await expect(updater.check({ checkUpdates: false })).resolves.toBe(false);
    expect(client.checkForUpdates).not.toHaveBeenCalled();
  });

  test('skips update checks for unsupported Linux installations', async () => {
    const unsupportedUpdater = new Updater(client, 'linux', {});

    await expect(unsupportedUpdater.check({ checkUpdates: true })).resolves.toBe(false);
    await expect(unsupportedUpdater.download()).resolves.toBe(false);
    expect(unsupportedUpdater.install()).toBe(false);
    expect(client.checkForUpdates).not.toHaveBeenCalled();
    expect(client.downloadUpdate).not.toHaveBeenCalled();
    expect(client.quitAndInstall).not.toHaveBeenCalled();
  });

  test('supports Debian updates with explicit download and install confirmation', async () => {
    const debClient = Object.assign(new DebUpdater(), {
      checkForUpdates: jest.fn().mockResolvedValue(undefined),
      downloadUpdate: jest.fn().mockResolvedValue(undefined),
      quitAndInstall: jest.fn(),
    });
    const debUpdater = new Updater(debClient, 'linux', {});
    debUpdater.initialize(send);

    expect(debClient.autoDownload).toBe(false);
    expect(debClient.autoInstallOnAppQuit).toBe(false);
    await expect(debUpdater.check({ checkUpdates: false })).resolves.toBe(false);
    await debUpdater.check({ checkUpdates: true });
    expect(debClient.checkForUpdates).toHaveBeenCalledTimes(1);
    debClient.emit('update-available', { version: '2.1.0' });
    expect(send).toHaveBeenCalledWith('update-available', expect.objectContaining({ version: '2.1.0' }));
    expect(debClient.downloadUpdate).not.toHaveBeenCalled();
    expect(debClient.quitAndInstall).not.toHaveBeenCalled();
    await debUpdater.download();
    expect(debClient.downloadUpdate).toHaveBeenCalledTimes(1);
    expect(debClient.quitAndInstall).not.toHaveBeenCalled();
    debClient.emit('update-downloaded', { version: '2.1.0' });
    expect(send).toHaveBeenCalledWith('update-downloaded', expect.objectContaining({ version: '2.1.0' }));
    expect(debUpdater.install()).toBe(true);
    expect(debClient.quitAndInstall).toHaveBeenCalledTimes(1);
    debClient.emit('error', new Error('Authorization denied'));
    expect(send).toHaveBeenCalledWith('update-error', { message: 'Authorization denied' });
  });

  test('emits serializable update state and downloads only after an explicit request', async () => {
    client.emit('update-available', { version: '2.1.0', releaseNotes: 'Bug fixes' });
    client.emit('download-progress', { percent: 42.7, transferred: 427, total: 1000, bytesPerSecond: 100 });
    client.emit('update-downloaded', { version: '2.1.0' });

    expect(client.downloadUpdate).not.toHaveBeenCalled();
    expect(send).toHaveBeenNthCalledWith(
      1,
      'update-available',
      expect.objectContaining({ version: '2.1.0', releaseNotes: 'Bug fixes' })
    );
    expect(send).toHaveBeenNthCalledWith(
      2,
      'update-download-progress',
      expect.objectContaining({ percent: 43, transferred: 427, total: 1000 })
    );
    expect(send).toHaveBeenNthCalledWith(3, 'update-downloaded', expect.objectContaining({ version: '2.1.0' }));

    await updater.download();
    expect(client.downloadUpdate).toHaveBeenCalledTimes(1);
    expect(client.quitAndInstall).not.toHaveBeenCalled();

    updater.install();
    expect(client.quitAndInstall).toHaveBeenCalledTimes(1);
  });

  test('normalizes updater errors before sending them to the renderer', () => {
    client.emit('error', new Error('network unavailable'));

    expect(send).toHaveBeenCalledWith('update-error', { message: 'network unavailable' });
  });
});
