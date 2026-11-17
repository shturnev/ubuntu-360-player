const fs = require('fs');
const path = require('path');

function frameRate(value) {
  const match = /^(\d+)\/(\d+)$/.exec(String(value));
  if (!match || Number(match[2]) === 0) return NaN;
  return Number(match[1]) / Number(match[2]);
}

function videoInfo(metadata) {
  const videos = (Array.isArray(metadata?.streams) ? metadata.streams : []).filter(
    (stream) => stream.codec_type === 'video'
  );
  if (videos.length !== 1) throw new Error('Each INSV lens must contain exactly one video stream.');
  const video = videos[0];
  const fps = frameRate(video.r_frame_rate);
  const duration = Number(video.duration);
  const start = Number(video.start_time);
  if (
    video.codec_name !== 'h264' ||
    !Number.isSafeInteger(video.width) ||
    video.width <= 0 ||
    video.width !== video.height ||
    !Number.isFinite(fps) ||
    fps <= 0 ||
    !Number.isFinite(duration) ||
    duration <= 0 ||
    video.start_time == null ||
    !Number.isFinite(start)
  ) {
    throw new Error('Unsupported or invalid INSV video stream; H.264 square video and timestamps are required.');
  }
  return { width: video.width, height: video.height, fps, duration, start };
}

function sameFileState(a, b) {
  return (
    a.isFile() &&
    b.isFile() &&
    a.dev === b.dev &&
    a.ino === b.ino &&
    a.size === b.size &&
    a.mtimeMs === b.mtimeMs &&
    a.ctimeMs === b.ctimeMs
  );
}

function snapshot(stat) {
  return {
    dev: stat.dev,
    ino: stat.ino,
    size: stat.size,
    mtimeMs: stat.mtimeMs,
    ctimeMs: stat.ctimeMs,
  };
}

function matchesSnapshot(stat, expected) {
  return (
    stat.isFile() &&
    stat.dev === expected.dev &&
    stat.ino === expected.ino &&
    stat.size === expected.size &&
    stat.mtimeMs === expected.mtimeMs &&
    stat.ctimeMs === expected.ctimeMs
  );
}

async function assertCurrentPair(pair) {
  for (let index = 0; index < 2; index += 1) {
    const file = pair.paths[index];
    if (
      (await fs.promises.realpath(file)) !== file ||
      !matchesSnapshot(await fs.promises.stat(file), pair.snapshots[index])
    ) {
      throw new Error('An INSV source changed while it was being checked.');
    }
  }
}

async function validateInsvPair(files, probeVideo, verifyVideo) {
  if (!Array.isArray(files) || files.length !== 2 || files.some((file) => typeof file !== 'string')) {
    throw new Error('Invalid INSV pair.');
  }
  const directories = await Promise.all(files.map((file) => fs.promises.realpath(path.dirname(file))));
  const paths = await Promise.all(files.map((file) => fs.promises.realpath(file)));
  if (directories[0] !== directories[1] || paths.some((file) => path.dirname(file) !== directories[0])) {
    throw new Error('INSV lenses must be original files in the same directory.');
  }
  const before = await Promise.all(paths.map((file) => fs.promises.stat(file)));
  if (before.some((stat) => !stat.isFile()) || (before[0].dev === before[1].dev && before[0].ino === before[1].ino)) {
    throw new Error('INSV lenses must be two distinct regular files.');
  }

  const metadata = await Promise.all(paths.map((file) => probeVideo(file)));
  const [first, second] = metadata.map(videoInfo);
  if (
    first.width !== second.width ||
    first.height !== second.height ||
    Math.abs(first.fps - second.fps) > 0.001 ||
    Math.abs(first.start - second.start) > 1 / first.fps ||
    Math.abs(first.duration - second.duration) > 2 / first.fps
  ) {
    throw new Error('INSV lenses have incompatible video dimensions, frame rates or timestamps.');
  }
  const sampleTime = Math.min(1, first.duration / 2);
  const timestamps = [];
  for (const file of paths) {
    timestamps.push(await verifyVideo(file, sampleTime));
  }
  if (
    timestamps.some((timestamp) => !Number.isFinite(timestamp)) ||
    Math.abs(timestamps[0] - timestamps[1]) > 0.5 / first.fps
  ) {
    throw new Error('INSV lenses do not have matching decoded frame timestamps.');
  }
  const after = await Promise.all(paths.map((file) => fs.promises.stat(file)));
  const currentPaths = await Promise.all(files.map((file) => fs.promises.realpath(file)));
  if (paths.some((file, index) => file !== currentPaths[index] || !sameFileState(before[index], after[index]))) {
    throw new Error('An INSV source changed while it was being checked.');
  }
  return { paths, video: first, snapshots: after.map(snapshot), sampleTime };
}

module.exports = { validateInsvPair, assertCurrentPair, matchesSnapshot };
