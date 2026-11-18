const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Errors meaning "this filesystem or account cannot do that", as opposed to real failures.
const UNSUPPORTED = new Set(['EPERM', 'EACCES', 'ENOTSUP', 'EOPNOTSUPP', 'ENOSYS', 'EXDEV', 'EINVAL', 'UNKNOWN']);

// Originals that are served directly from their location (no copy, no link in the cache).
const sourceEntries = new Map();

function registerSource(bigName, origPath) {
  sourceEntries.set(bigName, origPath);
}

function getSource(bigName) {
  return sourceEntries.get(bigName);
}

function unregisterSource(bigName) {
  sourceEntries.delete(bigName);
}

function clearSources() {
  sourceEntries.clear();
}

function copyAtomically(origPath, linkPath) {
  const tempPath = `${linkPath}.${crypto.randomUUID()}.tmp`;
  try {
    fs.copyFileSync(origPath, tempPath, fs.constants.COPYFILE_EXCL);
    fs.renameSync(tempPath, linkPath);
  } catch (error) {
    try {
      fs.unlinkSync(tempPath);
    } catch (cleanupError) {
      // The temporary copy may never have been created.
    }
    throw error;
  }
}

/**
 * Exposes an original in the cache directory without ever modifying it.
 * Order: symlink -> image copy (small, needed for EXIF) -> video hard link
 * (same volume, zero extra disk) -> video served directly from its original
 * location via the authorized /big/ route (no copy of multi-gigabyte files).
 * Returns the strategy used: 'symlink' | 'copy' | 'hardlink' | 'source'.
 */
function linkOriginal(origPath, linkPath, kind) {
  try {
    fs.symlinkSync(origPath, linkPath);
    return 'symlink';
  } catch (error) {
    if (!UNSUPPORTED.has(error.code)) throw error;
  }

  if (kind === 'image') {
    copyAtomically(origPath, linkPath);
    return 'copy';
  }

  try {
    fs.linkSync(origPath, linkPath);
    return 'hardlink';
  } catch (error) {
    if (!UNSUPPORTED.has(error.code)) throw error;
  }

  registerSource(path.basename(linkPath), origPath);
  return 'source';
}

module.exports = { clearSources, getSource, linkOriginal, registerSource, unregisterSource };
