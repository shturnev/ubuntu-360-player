const { execFile } = require('child_process');
const mediaTools = require('./mediaTools');

function run(command, args) {
  return new Promise((resolve, reject) => {
    execFile(command, args, { timeout: 120000, maxBuffer: 128 * 1024 * 1024 }, (error, stdout) => {
      if (error) reject(error);
      else resolve(stdout);
    });
  });
}

function runExiftool(args) {
  return Promise.resolve().then(() => {
    const invocation = mediaTools.exiftool(args);
    return run(invocation.command, invocation.args);
  });
}

function runFfprobe(args) {
  return Promise.resolve().then(() => run(mediaTools.ffprobe(), args));
}

function parseTelemetry(text) {
  const samples = new Map();
  const captureTimes = [];
  let model;
  for (const line of text.split('\n')) {
    const modelMatch = /^\[Insta360\]\s+Model\s*:\s*(.*?)\s*$/.exec(line);
    if (modelMatch) model = modelMatch[1];
    const match =
      /^\[Doc(\d+):Insta360\]\s+(TimeCode|Accelerometer|AngularVelocity|ExposureTime|VideoTimeStamp)\s*:\s*(.*?)\s*$/.exec(
        line
      );
    if (!match) continue;
    const [, document, tag, value] = match;
    if (tag === 'VideoTimeStamp') {
      captureTimes.push(Number(value));
    } else {
      const sample = samples.get(document) || {};
      if (tag === 'TimeCode') sample.time = Number(value);
      else if (tag === 'Accelerometer') sample.acceleration = value.split(/\s+/).map(Number);
      else if (tag === 'AngularVelocity') sample.angularVelocity = value.split(/\s+/).map(Number);
      else sample.exposure = Number(value);
      samples.set(document, sample);
    }
  }
  const imu = [...samples.values()]
    .filter((sample) => Number.isFinite(sample.time) && sample.acceleration?.length === 3)
    .sort((a, b) => a.time - b.time);
  const exposureTimes = [...samples.values()]
    .filter((sample) => Number.isFinite(sample.time) && Number.isFinite(sample.exposure) && sample.exposure > 0)
    .map((sample) => sample.time)
    .sort((a, b) => a - b);
  return { model, imu, captureTimes, exposureTimes };
}

function lowerBound(values, value, getValue, inclusive = false) {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (getValue(values[middle]) < value || (inclusive && getValue(values[middle]) === value)) low = middle + 1;
    else high = middle;
  }
  return low;
}

function makeHorizonTrack({ model, imu, captureTimes }, playbackTimes) {
  if (model !== 'Insta360 One2') throw new Error('Horizon leveling is not calibrated for this INSV camera.');
  if (
    !imu.length ||
    !captureTimes.length ||
    captureTimes.length !== playbackTimes.length ||
    Math.abs(playbackTimes[0]) > 0.02 ||
    playbackTimes.some((time, index) => !Number.isFinite(time) || (index && time <= playbackTimes[index - 1])) ||
    captureTimes.some((time, index) => !Number.isFinite(time) || (index && time <= captureTimes[index - 1]))
  ) {
    throw new Error('Horizon leveling requires matching per-frame capture and playback timestamps.');
  }

  return captureTimes.map((captureTime, index) => {
    const position = lowerBound(imu, captureTime, (sample) => sample.time);
    const near = [imu[position - 1], imu[position]].filter(Boolean);
    if (!near.length || Math.min(...near.map((sample) => Math.abs(sample.time - captureTime))) > 0.1) {
      throw new Error('An INSV frame has no nearby motion data.');
    }
    const start = lowerBound(imu, captureTime - 0.1, (sample) => sample.time);
    const end = lowerBound(imu, captureTime + 0.1, (sample) => sample.time, true);
    const valid = imu.slice(start, end).filter(({ acceleration }) => {
      const length = Math.hypot(...acceleration);
      return acceleration.every(Number.isFinite) && length >= 0.7 && length <= 1.3;
    });
    if (!valid.length) throw new Error('The INSV accelerometer data cannot reliably determine the horizon.');
    const sum = valid.reduce(
      (total, sample) => total.map((value, axis) => value + sample.acceleration[axis]),
      [0, 0, 0]
    );
    const length = Math.hypot(...sum);
    if (length < 1e-8) throw new Error('The INSV accelerometer data cannot reliably determine the horizon.');
    const [x, y, z] = [sum[0] / length, sum[2] / length, -sum[1] / length];
    const qlength = Math.hypot(z, -x, 1 + y);
    if (qlength < 1e-8) throw new Error('The INSV horizon orientation is ambiguous.');
    return { time: playbackTimes[index], rotation: [z / qlength, 0, -x / qlength, (1 + y) / qlength] };
  });
}

async function createInsvHorizonTrack(pair) {
  const file = pair.paths[0];
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
  return makeHorizonTrack(
    parseTelemetry(metadata),
    decoded.frames.map((frame) => Number(frame.best_effort_timestamp_time))
  );
}

module.exports = { createInsvHorizonTrack, parseTelemetry, makeHorizonTrack, run, runExiftool, runFfprobe, lowerBound };
