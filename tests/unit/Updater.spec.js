const Updater = require('../../src/models/Updater');
const BaseConfig = require('../../project.config');

describe('Updater', () => {
  const nativeFetch = global.fetch;

  afterEach(() => {
    if (nativeFetch) {
      global.fetch = nativeFetch;
    } else {
      delete global.fetch;
    }
  });

  test('returns false when updates are disabled', async () => {
    const result = await Updater.check({ ...BaseConfig, checkUpdates: false });
    expect(result).toBe(false);
  });

  test('returns payload when remote version differs', async () => {
    const response = {
      data: {
        filename_orig: '360-media-viewer_1.0.6.tar.gz',
        hash: 'abc123'
      }
    };

    global.fetch = jest.fn().mockResolvedValue({
      text: jest.fn().mockResolvedValue(JSON.stringify(response))
    });

    const result = await Updater.check(BaseConfig);
    expect(result).toHaveProperty('filename_orig', response.data.filename_orig);
    expect(result).toHaveProperty('hash', 'abc123');
    expect(global.fetch).toHaveBeenCalledWith(
      'https://upfiler.sht-server.cf/api/',
      expect.objectContaining({
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: expect.stringContaining('action=file_get_last_in_album'),
        redirect: 'error'
      })
    );
  });

  test('rejects updater redirects', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('redirect blocked'));

    await expect(Updater.check(BaseConfig)).rejects.toThrow('redirect blocked');
    expect(global.fetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ redirect: 'error' })
    );
  });
});
