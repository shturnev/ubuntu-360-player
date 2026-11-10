const request = require('request');
const Updater = require('../../src/models/Updater');
const BaseConfig = require('../../project.config');

jest.mock('request', () => ({
  post: jest.fn()
}));

describe('Updater', () => {
  test('returns false when updates are disabled', async () => {
    const result = await Updater.check({ ...BaseConfig, checkUpdates: false });
    expect(result).toBe(false);
  });

  test('returns payload when remote version differs', async () => {
    const response = {
      data: {
        filename_orig: 'sht-vr-player_1.0.6.tar.gz',
        hash: 'abc123'
      }
    };

    request.post.mockImplementation((_options, callback) => {
      callback(null, {}, JSON.stringify(response));
    });

    const result = await Updater.check(BaseConfig);
    expect(result).toHaveProperty('filename_orig', response.data.filename_orig);
    expect(result).toHaveProperty('hash', 'abc123');
  });
});
