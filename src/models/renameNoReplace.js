const fs = require('fs');

// Hard links are unavailable on some filesystems (FAT/exFAT, some network shares).
const LINK_UNSUPPORTED = new Set(['EPERM', 'ENOTSUP', 'EOPNOTSUPP', 'ENOSYS', 'EXDEV', 'EINVAL']);

/**
 * Moves source to target and fails with EEXIST if target exists.
 * link() is atomic and never replaces, on Linux and on NTFS alike.
 * Fallback: exclusive copy (COPYFILE_EXCL), then removal of the source.
 */
async function renameNoReplace(source, target) {
  try {
    await fs.promises.link(source, target);
  } catch (error) {
    if (error.code === 'EEXIST') throw error;
    if (!LINK_UNSUPPORTED.has(error.code)) {
      throw new Error(`Unable to publish media without overwriting: ${error.message}`);
    }
    try {
      await fs.promises.copyFile(source, target, fs.constants.COPYFILE_EXCL);
    } catch (copyError) {
      if (copyError.code === 'EEXIST') throw copyError;
      await fs.promises.unlink(target).catch(() => {});
      throw new Error(`Unable to publish media without overwriting: ${copyError.message}`);
    }
  }
  await fs.promises.unlink(source);
}

module.exports = renameNoReplace;
