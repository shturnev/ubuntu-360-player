const crypto = require('crypto');
const fs = require('fs');
const { renameSyncWithRetry } = require('./fsRetry');
const { isValidLensFov } = require('./lensFov');

function insvIdentity(pair) {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(['insv-v1', pair.paths, pair.snapshots]))
    .digest('hex');
}

class LensOverrides {
  constructor(filePath) {
    this.filePath = filePath;
  }

  read() {
    let data;
    try {
      data = fs.readFileSync(this.filePath, 'utf8');
    } catch (error) {
      if (error.code === 'ENOENT') return {};
      throw new Error(`Unable to read lens corrections: ${error.message}`);
    }

    let stored;
    try {
      stored = JSON.parse(data);
    } catch (error) {
      throw new Error('The saved lens corrections are corrupted.');
    }
    if (
      !stored ||
      stored.version !== 1 ||
      !stored.entries ||
      typeof stored.entries !== 'object' ||
      Array.isArray(stored.entries) ||
      Object.entries(stored.entries).some(([key, value]) => !/^[0-9a-f]{64}$/.test(key) || !isValidLensFov(value))
    ) {
      throw new Error('The saved lens corrections are corrupted.');
    }
    return stored.entries;
  }

  get(key) {
    return this.read()[key];
  }

  set(key, value) {
    if (!/^[0-9a-f]{64}$/.test(key) || (value !== null && !isValidLensFov(value))) {
      throw new Error('Invalid lens correction.');
    }
    const entries = this.read();
    if (value === null) delete entries[key];
    else entries[key] = value;

    const temporary = `${this.filePath}.${crypto.randomUUID()}.tmp`;
    let created = false;
    let fd;
    try {
      fd = fs.openSync(temporary, 'wx', 0o600);
      created = true;
      fs.writeFileSync(fd, JSON.stringify({ version: 1, entries }));
      fs.closeSync(fd);
      fd = undefined;
      renameSyncWithRetry(temporary, this.filePath);
      created = false;
    } catch (error) {
      throw new Error(`Unable to save lens correction: ${error.message}`);
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
      if (created) fs.unlinkSync(temporary);
    }
  }
}

module.exports = { LensOverrides, insvIdentity };
