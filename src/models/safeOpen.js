const fs = require('fs');
const { isSamePath } = require('./pathCompare');

/**
 * Opens a regular file for reading without following a symlink/junction at the final component.
 * POSIX relies on O_NOFOLLOW. Windows has no such flag, so the path is lstat'ed before the open
 * and the opened handle is compared with that result (and with the resolved path) afterwards.
 */
async function openFileNoFollow(filePath, platform = process.platform) {
  if (platform !== 'win32') {
    return fs.promises.open(filePath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  }

  const before = await fs.promises.lstat(filePath, { bigint: true });
  if (!before.isFile()) throw Object.assign(new Error('Not a regular file.'), { code: 'ELOOP' });
  const handle = await fs.promises.open(filePath, fs.constants.O_RDONLY);
  try {
    const opened = await handle.stat({ bigint: true });
    const real = await fs.promises.realpath(filePath);
    if (
      !opened.isFile() ||
      opened.ino !== before.ino ||
      opened.dev !== before.dev ||
      opened.size !== before.size ||
      !isSamePath(real, filePath)
    ) {
      throw Object.assign(new Error('The file changed or is a reparse point.'), { code: 'ELOOP' });
    }
    return handle;
  } catch (error) {
    await handle.close().catch(() => {});
    throw error;
  }
}

module.exports = { openFileNoFollow };
