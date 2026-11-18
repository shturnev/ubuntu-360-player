const fs = require('fs');
const { lowerBound, parseTelemetry, runExiftool, runFfprobe } = require('./insvHorizon');
const { openFileNoFollow } = require('./safeOpen');

function readVarint(data, position) {
  let value = 0n;
  for (let shift = 0n; shift < 70n; shift += 7n) {
    if (position >= data.length) throw new Error('Invalid INSV camera metadata.');
    const byte = data[position++];
    value |= BigInt(byte & 127) << shift;
    if (!(byte & 128)) {
      if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Invalid INSV camera metadata.');
      return [Number(value), position];
    }
  }
  throw new Error('Invalid INSV camera metadata.');
}

function parseCameraTiming(data) {
  const fields = new Map();
  let pos = 0;
  while (pos < data.length) {
    let key;
    [key, pos] = readVarint(data, pos);
    const tag = Math.floor(key / 8);
    const wire = key % 8;
    if (!tag) throw new Error('Invalid INSV camera metadata.');
    let value;
    if (wire === 0) [value, pos] = readVarint(data, pos);
    else if (wire === 1) {
      if (pos + 8 > data.length) throw new Error('Invalid INSV camera metadata.');
      value = data.readDoubleLE(pos);
      pos += 8;
    } else if (wire === 2) {
      let size;
      [size, pos] = readVarint(data, pos);
      if (size > data.length - pos) throw new Error('Invalid INSV camera metadata.');
      pos += size;
    } else if (wire === 5) {
      if (pos + 4 > data.length) throw new Error('Invalid INSV camera metadata.');
      pos += 4;
    } else throw new Error('Invalid INSV camera metadata.');
    if ([24, 28, 29, 30, 59, 62].includes(tag)) {
      if (fields.has(tag) || wire !== (tag === 28 ? 1 : 0)) throw new Error('Invalid INSV camera timing metadata.');
      fields.set(tag, value);
    }
  }
  if (!fields.has(24) || !fields.get(24) || fields.get(62) || fields.get(30) || fields.get(59)) {
    throw new Error('Gyro stabilization requires calibrated non-timelapse INSV motion data.');
  }
  if ((fields.get(29) && !Number.isFinite(fields.get(28))) || ![0, 1, undefined].includes(fields.get(29))) {
    throw new Error('Invalid INSV gyro timing metadata.');
  }
  return { firstFrame: fields.get(24) / 1000, gyroOffset: fields.get(29) ? fields.get(28) / 1000 : 0 };
}

async function readCameraTiming(file) {
  const handle = await openFileNoFollow(file);
  try {
    const size = (await handle.stat()).size;
    const read = async (position, length) => {
      const buffer = Buffer.alloc(length);
      const { bytesRead } = await handle.read(buffer, 0, length, position);
      if (bytesRead !== length) throw new Error('Invalid INSV trailer.');
      return buffer;
    };
    if (size < 78) throw new Error('Invalid INSV trailer.');
    const footer = await read(size - 40, 40);
    if (footer.subarray(8).toString('ascii') !== '8db42d694ccc418790edff439fe026bf') {
      throw new Error('Invalid INSV trailer.');
    }
    const trailerSize = footer.readUInt32LE(0);
    if (trailerSize < 78 || trailerSize > size) throw new Error('Invalid INSV trailer.');
    let offset = 78;
    for (let count = 0; count < 256 && offset <= trailerSize; count += 1) {
      const descriptor = await read(size - offset, 6);
      const format = descriptor[0];
      const id = descriptor[1];
      const length = descriptor.readUInt32LE(2);
      if (length > trailerSize - offset) throw new Error('Invalid INSV trailer.');
      offset += length;
      if (id === 1) {
        if (format !== 1 || length > 1024 * 1024) throw new Error('Unsupported INSV camera metadata.');
        return parseCameraTiming(await read(size - offset, length));
      }
      offset += 6;
    }
    throw new Error('INSV camera timing metadata is missing.');
  } finally {
    await handle.close();
  }
}

function multiply(a, b) {
  const [x, y, z, w] = a;
  const [X, Y, Z, W] = b;
  return [
    w * X + x * W + y * Z - z * Y,
    w * Y - x * Z + y * W + z * X,
    w * Z + x * Y - y * X + z * W,
    w * W - x * X - y * Y - z * Z,
  ];
}

function normalize(q) {
  const length = Math.hypot(...q);
  if (!Number.isFinite(length) || length < 1e-8) throw new Error('The INSV motion orientation is ambiguous.');
  return q.map((value) => value / length);
}

const inverse = ([x, y, z, w]) => [-x, -y, -z, w];
const rotate = (q, v) => multiply(multiply(q, [...v, 0]), inverse(q)).slice(0, 3);
const horizonFor = ([x, y, z]) => normalize([z, 0, -x, 1 + y]);

function makeGyroTrack({ model, imu, captureTimes, exposureTimes }, playback, timing) {
  if (model !== 'Insta360 One2') throw new Error('Gyro stabilization is not calibrated for this INSV camera.');
  if (
    captureTimes.length ||
    !playback.length ||
    Math.abs(playback[0]) > 0.02 ||
    playback.some((t, i) => !Number.isFinite(t) || (i && (t <= playback[i - 1] || t - playback[i - 1] > 0.1))) ||
    !Number.isFinite(timing.firstFrame) ||
    !Number.isFinite(timing.gyroOffset) ||
    !exposureTimes.length
  ) {
    throw new Error('Gyro stabilization requires reliable normal-video frame timestamps.');
  }
  const targets = playback.map((time) => timing.firstFrame + timing.gyroOffset + time);
  if (
    imu.length < 2 ||
    targets[0] < imu[0].time ||
    targets[targets.length - 1] > imu[imu.length - 1].time ||
    imu.some(
      (sample, i) =>
        !Array.isArray(sample.angularVelocity) ||
        sample.angularVelocity.length !== 3 ||
        sample.angularVelocity.some((v) => !Number.isFinite(v)) ||
        (i && (sample.time <= imu[i - 1].time || sample.time - imu[i - 1].time > 0.02))
    )
  ) {
    throw new Error('The INSV gyroscope data is incomplete or has timing gaps.');
  }
  for (const time of playback) {
    const capture = timing.firstFrame + time;
    const index = lowerBound(exposureTimes, capture, (v) => v);
    const nearest = [exposureTimes[index - 1], exposureTimes[index]].filter(Number.isFinite);
    if (!nearest.length || Math.min(...nearest.map((v) => Math.abs(v - capture))) > 0.035) {
      throw new Error('INSV frame timestamps do not match the camera exposure records.');
    }
  }

  let raw = [0, 0, 0, 1];
  let fused;
  let previousRaw;
  let cursor = 0;
  let last = imu[0].time;
  const frames = targets.map((target, frameIndex) => {
    while (last < target) {
      while (cursor + 1 < imu.length && imu[cursor + 1].time <= last) cursor += 1;
      const a = imu[cursor];
      const b = imu[cursor + 1];
      const end = Math.min(target, b.time);
      const dt = end - last;
      const fraction = ((last + end) / 2 - a.time) / (b.time - a.time);
      const v = a.angularVelocity.map((value, axis) => value + fraction * (b.angularVelocity[axis] - value));
      const omega = [-v[0], -v[2], v[1]];
      const speed = Math.hypot(...omega);
      if (speed) {
        const scale = Math.sin((speed * dt) / 2) / speed;
        raw = normalize(multiply([...omega.map((value) => value * scale), Math.cos((speed * dt) / 2)], raw));
      }
      last = end;
    }
    const start = lowerBound(imu, target - 0.1, (sample) => sample.time);
    const end = lowerBound(imu, target + 0.1, (sample) => sample.time, true);
    const vectors = imu
      .slice(start, end)
      .map((sample) => sample.acceleration)
      .filter((v) => {
        const length = Math.hypot(...v);
        return v.every(Number.isFinite) && length >= 0.7 && length <= 1.3;
      });
    if (!vectors.length) throw new Error('The INSV accelerometer data cannot reliably determine the horizon.');
    const sum = vectors.reduce((total, vector) => total.map((value, axis) => value + vector[axis]), [0, 0, 0]);
    const length = Math.hypot(...sum);
    if (length < 1e-8) throw new Error('The INSV motion orientation is ambiguous.');
    const gravity = [sum[0] / length, sum[2] / length, -sum[1] / length];
    if (!fused) fused = horizonFor(gravity);
    else {
      fused = normalize(multiply(multiply(raw, inverse(previousRaw)), fused));
      const predicted = rotate(fused, [0, 1, 0]);
      const [x, y, z] = predicted;
      const [X, Y, Z] = gravity;
      const dot = x * X + y * Y + z * Z;
      const delta = normalize([y * Z - z * Y, z * X - x * Z, x * Y - y * X, 1 + dot]);
      const halfAngle = Math.acos(Math.max(-1, Math.min(1, delta[3])));
      const confidence = Math.max(0, 1 - Math.abs(length / vectors.length - 1) / 0.2);
      const amount = (1 - Math.exp(-(playback[frameIndex] - playback[frameIndex - 1]) / 1.5)) * confidence;
      const scale = halfAngle > 1e-8 ? Math.sin(halfAngle * amount) / Math.sin(halfAngle) : amount;
      fused = normalize(
        multiply([...delta.slice(0, 3).map((value) => value * scale), Math.cos(halfAngle * amount)], fused)
      );
    }
    previousRaw = raw;
    const horizon = horizonFor(rotate(fused, [0, 1, 0]));
    const relative = multiply(inverse(horizon), fused);
    return { time: playback[frameIndex], horizon, yaw: normalize([0, relative[1], 0, relative[3]]) };
  });
  return frames.map((frame) => {
    const start = lowerBound(frames, frame.time - 0.75, (value) => value.time);
    const end = lowerBound(frames, frame.time + 0.75, (value) => value.time, true);
    const sum = [0, 0, 0, 0];
    for (let i = start; i < end; i += 1) {
      const other = frames[i];
      const sign = frame.yaw.reduce((total, value, axis) => total + value * other.yaw[axis], 0) >= 0 ? 1 : -1;
      const weight = Math.exp(-0.5 * ((other.time - frame.time) / 0.25) ** 2) * sign;
      other.yaw.forEach((value, axis) => {
        sum[axis] += weight * value;
      });
    }
    return {
      time: frame.time,
      rotation: normalize(multiply(frame.horizon, multiply(frame.yaw, inverse(normalize(sum))))),
    };
  });
}

async function createInsvGyroTrack(pair) {
  const file = pair.paths[0];
  const timing = await readCameraTiming(file);
  const [metadata, frames] = await Promise.all([
    runExiftool([
      '-m',
      '-ee',
      '-G3:1',
      '-a',
      '-n',
      '-s',
      '-Model',
      '-TimeCode',
      '-Accelerometer',
      '-AngularVelocity',
      '-ExposureTime',
      '-VideoTimeStamp',
      file,
    ]),
    runFfprobe([
      '-v',
      'error',
      '-select_streams',
      'v:0',
      '-show_frames',
      '-show_entries',
      'frame=best_effort_timestamp_time',
      '-of',
      'json',
      file,
    ]),
  ]);
  const decoded = JSON.parse(frames);
  if (!Array.isArray(decoded.frames)) throw new Error('Unable to read INSV video frame timestamps.');
  return makeGyroTrack(
    parseTelemetry(metadata),
    decoded.frames.map((frame) => Number(frame.best_effort_timestamp_time)),
    timing
  );
}

module.exports = { createInsvGyroTrack, makeGyroTrack, parseCameraTiming, readCameraTiming };
