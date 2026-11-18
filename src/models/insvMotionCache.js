const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { assertCurrentPair } = require('./insvPair');
const { prepareInsvMotion } = require('./insvMotion');

// Increment when the gyro, horizon, or timestamp algorithms change.
const CACHE_VERSION = 1;
const MAX_CACHE_BYTES = 128 * 1024 * 1024;
const digest = (value) => crypto.createHash('sha256').update(value).digest('hex');

function isValidMotion(motion) {
  if (
    !motion ||
    !['gyro', 'horizon', 'none'].includes(motion.mode) ||
    typeof motion.warning !== 'string' ||
    !Array.isArray(motion.frames) ||
    (motion.mode === 'none' ? motion.frames.length !== 0 : motion.frames.length === 0) ||
    (motion.mode === 'gyro' ? motion.warning !== '' : !motion.warning)
  )
    return false;
  return motion.frames.every(
    (frame, index) =>
      Number.isFinite(frame?.time) &&
      (!index || frame.time > motion.frames[index - 1].time) &&
      Array.isArray(frame.rotation) &&
      frame.rotation.length === 4 &&
      frame.rotation.every(Number.isFinite) &&
      Math.abs(Math.hypot(...frame.rotation) - 1) <= 0.001
  );
}

async function readMotionCache(file, key) {
  let handle;
  try {
    handle = await fs.promises.open(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > MAX_CACHE_BYTES) throw new Error('Invalid INSV stabilization cache file.');
    const record = JSON.parse(await handle.readFile('utf8'));
    if (
      !record ||
      typeof record !== 'object' ||
      record.version !== CACHE_VERSION ||
      record.key !== key ||
      !isValidMotion(record.motion) ||
      record.checksum !== digest(JSON.stringify(record.motion))
    )
      throw new Error('Invalid INSV stabilization cache data.');
    return record.motion;
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    if (
      error instanceof SyntaxError ||
      error.code === 'ELOOP' ||
      error.message.startsWith('Invalid INSV stabilization cache')
    ) {
      console.warn('Invalid INSV stabilization cache; recalculating.');
      return null;
    }
    throw new Error('Unable to read the INSV stabilization cache.');
  } finally {
    await handle?.close();
  }
}

async function getCachedInsvMotion(pair, cacheDir, { isCurrent = () => true, onCacheMiss } = {}) {
  const key = digest(JSON.stringify([CACHE_VERSION, pair.paths, pair.snapshots, pair.video]));
  const target = path.join(cacheDir, `${key}.json`);
  await assertCurrentPair(pair);
  const cached = await readMotionCache(target, key);
  if (cached) {
    await assertCurrentPair(pair);
    if (!isCurrent()) throw new Error('INSV import was cancelled.');
    return cached;
  }

  if (!isCurrent()) throw new Error('INSV import was cancelled.');
  onCacheMiss?.();
  let transientFailure = false;
  const motion = await prepareInsvMotion(pair, {
    onTransientFailure: () => {
      transientFailure = true;
    },
  });
  await assertCurrentPair(pair);
  if (!isCurrent()) throw new Error('INSV import was cancelled.');
  if (!isValidMotion(motion)) throw new Error('The INSV stabilization data is invalid.');
  if (transientFailure) return motion;
  const record = JSON.stringify({ version: CACHE_VERSION, key, motion, checksum: digest(JSON.stringify(motion)) });
  if (Buffer.byteLength(record) > MAX_CACHE_BYTES)
    throw new Error('The INSV stabilization data is too large to cache.');
  const temporary = path.join(cacheDir, `.${key}.${crypto.randomUUID()}.tmp`);
  let created = false;
  try {
    await fs.promises.mkdir(cacheDir, { recursive: true, mode: 0o700 }).catch((error) => {
      throw new Error('Unable to write the INSV stabilization cache. Check disk space and permissions.', {
        cause: error,
      });
    });
    if (!isCurrent()) throw new Error('INSV import was cancelled.');
    await fs.promises.writeFile(temporary, record, { flag: 'wx', mode: 0o600 }).catch((error) => {
      throw new Error('Unable to write the INSV stabilization cache. Check disk space and permissions.', {
        cause: error,
      });
    });
    created = true;
    await assertCurrentPair(pair);
    if (!isCurrent()) throw new Error('INSV import was cancelled.');
    try {
      fs.renameSync(temporary, target);
    } catch (error) {
      throw new Error('Unable to write the INSV stabilization cache. Check disk space and permissions.', {
        cause: error,
      });
    }
    created = false;
  } finally {
    if (created)
      await fs.promises.unlink(temporary).catch((error) => {
        if (error.code !== 'ENOENT') throw error;
      });
  }
  return motion;
}

module.exports = { getCachedInsvMotion };
