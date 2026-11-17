const { createInsvGyroTrack } = require('./insvGyro');
const { createInsvHorizonTrack } = require('./insvHorizon');
const { assertCurrentPair } = require('./insvPair');

function describe(error) {
  return error.code ? 'Motion data could not be read; check ffprobe and ExifTool.' : error.message;
}

async function prepareInsvMotion(pair, { onTransientFailure } = {}) {
  try {
    const frames = await createInsvGyroTrack(pair);
    await assertCurrentPair(pair);
    return { mode: 'gyro', frames, warning: '' };
  } catch (gyroError) {
    if (gyroError.code || gyroError.killed) onTransientFailure?.();
    await assertCurrentPair(pair);
    try {
      const frames = await createInsvHorizonTrack(pair);
      await assertCurrentPair(pair);
      return {
        mode: 'horizon',
        frames,
        warning: `Stabilization unavailable; horizon leveling only. ${describe(gyroError)}`,
      };
    } catch (horizonError) {
      if (horizonError.code || horizonError.killed) onTransientFailure?.();
      await assertCurrentPair(pair);
      return {
        mode: 'none',
        frames: [],
        warning: `Stabilization and horizon leveling unavailable. ${describe(gyroError)} ${describe(horizonError)}`,
      };
    }
  }
}

function closestInsvRotation(frames, time) {
  if (!frames.length) return [0, 0, 0, 1];
  let low = 0;
  let high = frames.length - 1;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (frames[middle].time < time) low = middle + 1;
    else high = middle;
  }
  if (low > 0 && Math.abs(frames[low - 1].time - time) < Math.abs(frames[low].time - time)) low -= 1;
  return frames[low].rotation;
}

module.exports = { prepareInsvMotion, closestInsvRotation };
