const fs = require('fs');

const RETRY_CODES = new Set(['EPERM', 'EBUSY', 'EACCES']);
const DELAYS_MS = [20, 50, 100, 200, 400];

function shouldRetry(error, platform) {
  return platform === 'win32' && RETRY_CODES.has(error?.code);
}

// Windows can transiently lock files that antivirus, the indexer or a reader still holds open.
async function renameWithRetry(source, target, platform = process.platform) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await fs.promises.rename(source, target);
    } catch (error) {
      if (attempt >= DELAYS_MS.length || !shouldRetry(error, platform)) throw error;
      await new Promise((resolve) => setTimeout(resolve, DELAYS_MS[attempt]));
    }
  }
}

function renameSyncWithRetry(source, target, platform = process.platform) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return fs.renameSync(source, target);
    } catch (error) {
      if (attempt >= DELAYS_MS.length || !shouldRetry(error, platform)) throw error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, DELAYS_MS[attempt]);
    }
  }
}

module.exports = { renameWithRetry, renameSyncWithRetry };
