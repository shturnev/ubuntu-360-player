const fs = require('fs');
const { renameWithRetry, renameSyncWithRetry } = require('../../src/models/fsRetry');

afterEach(() => jest.restoreAllMocks());

const locked = () => Object.assign(new Error('locked'), { code: 'EBUSY' });

describe('fsRetry', () => {
  test('retries a transient EBUSY on Windows', async () => {
    const rename = jest
      .spyOn(fs.promises, 'rename')
      .mockRejectedValueOnce(locked())
      .mockRejectedValueOnce(locked())
      .mockResolvedValue();
    await renameWithRetry('a', 'b', 'win32');
    expect(rename).toHaveBeenCalledTimes(3);
  });

  test('does not retry outside Windows', async () => {
    const rename = jest.spyOn(fs.promises, 'rename').mockRejectedValue(locked());
    await expect(renameWithRetry('a', 'b', 'linux')).rejects.toThrow('locked');
    expect(rename).toHaveBeenCalledTimes(1);
  });

  test('gives up after the retry budget and ignores other errors', async () => {
    const rename = jest.spyOn(fs.promises, 'rename').mockRejectedValue(locked());
    await expect(renameWithRetry('a', 'b', 'win32')).rejects.toThrow('locked');
    expect(rename).toHaveBeenCalledTimes(6);
    rename.mockReset().mockRejectedValue(Object.assign(new Error('x'), { code: 'ENOENT' }));
    await expect(renameWithRetry('a', 'b', 'win32')).rejects.toThrow('x');
    expect(rename).toHaveBeenCalledTimes(1);
  });

  test('sync variant retries on Windows', () => {
    const rename = jest.spyOn(fs, 'renameSync').mockImplementationOnce(() => {
      throw locked();
    });
    rename.mockImplementation(() => undefined);
    renameSyncWithRetry('a', 'b', 'win32');
    expect(rename).toHaveBeenCalledTimes(2);
  });
});
