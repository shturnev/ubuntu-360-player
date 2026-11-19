const crypto = require('crypto');
const fs = require('fs');
const { renameSyncWithRetry } = require('./fsRetry');
const { isValidLensFov } = require('./lensFov');

function inspIdentity(filePath, snapshot) {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(['insp-v1', filePath, snapshot]))
    .digest('hex');
}

function isValidRotation(rotation) {
  return (
    rotation &&
    typeof rotation === 'object' &&
    Number.isFinite(rotation.yaw) &&
    Number.isFinite(rotation.pitch) &&
    Number.isFinite(rotation.roll) &&
    Math.abs(rotation.yaw) <= 180 &&
    Math.abs(rotation.pitch) <= 90 &&
    Math.abs(rotation.roll) <= 180
  );
}

function isValidCorrection(value) {
  return (
    value &&
    typeof value === 'object' &&
    (value.override === null || isValidLensFov(value.override)) &&
    Array.isArray(value.rotations) &&
    value.rotations.every(isValidRotation)
  );
}

class InspCorrections {
  constructor(filePath) {
    this.filePath = filePath;
  }

  read() {
    let data;
    try {
      data = fs.readFileSync(this.filePath, 'utf8');
    } catch (error) {
      if (error.code === 'ENOENT') return {};
      throw new Error(`Unable to read INSP corrections: ${error.message}`);
    }
    let stored;
    try {
      stored = JSON.parse(data);
    } catch {
      throw new Error('The saved INSP corrections are corrupted.');
    }
    if (
      !stored ||
      stored.version !== 1 ||
      !stored.entries ||
      typeof stored.entries !== 'object' ||
      Array.isArray(stored.entries) ||
      Object.entries(stored.entries).some(([key, value]) => !/^[0-9a-f]{64}$/.test(key) || !isValidCorrection(value))
    ) {
      throw new Error('The saved INSP corrections are corrupted.');
    }
    return stored.entries;
  }

  get(key) {
    return this.read()[key];
  }

  set(key, value) {
    if (!/^[0-9a-f]{64}$/.test(key) || !isValidCorrection(value)) throw new Error('Invalid INSP correction.');
    const entries = this.read();
    entries[key] = value;
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
      throw new Error(`Unable to save INSP corrections: ${error.message}`);
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
      if (created) fs.unlinkSync(temporary);
    }
  }
}

module.exports = { InspCorrections, inspIdentity, isValidRotation };
