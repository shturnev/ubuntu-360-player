const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { assertCurrentPair } = require('./insvPair');
const mediaTools = require('./mediaTools');
const { renameWithRetry } = require('./fsRetry');
const { projectInsvThumbnail } = require('./insvThumbnailProjection');
const geometry = require('../insvGeometry.json');
const { isValidLensFov } = require('./lensFov');

const THUMBNAIL_VERSION = `insv-projection-450x225-v5-${JSON.stringify(geometry)}`;
const SOURCE_SIZE = 720;
const WIDTH = 450;
const HEIGHT = 225;

function runFfmpeg(args, { input, ...options } = {}) {
  return new Promise((resolve, reject) => {
    const child = execFile(
      mediaTools.ffmpeg(),
      args,
      { timeout: 60000, maxBuffer: 8 * 1024 * 1024, ...options },
      (error, stdout) => {
        if (error) reject(error);
        else resolve(stdout);
      }
    );
    if (input) {
      child.stdin.once('error', reject);
      child.stdin.end(input);
    }
  });
}

async function isValidThumbnail(file, signal) {
  let stat;
  try {
    stat = await fs.promises.lstat(file);
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
  if (!stat.isFile() || stat.size === 0) return false;
  try {
    await runFfmpeg(
      [
        '-nostdin',
        '-v',
        'error',
        '-xerror',
        '-abort_on',
        'empty_output',
        '-i',
        file,
        '-frames:v',
        '1',
        '-f',
        'null',
        '-',
      ],
      { signal }
    );
    return true;
  } catch (error) {
    if (signal?.aborted) throw new Error('The INSV lens correction was cancelled.');
    if (typeof error.code === 'number' && !error.killed) return false;
    throw new Error('Unable to verify the INSV thumbnail. Make sure ffmpeg is available.');
  }
}

async function createInsvThumbnail(
  pair,
  smallDir,
  rotation = [0, 0, 0, 1],
  fieldOfViewDegrees = geometry.fieldOfViewDegrees,
  { signal } = {}
) {
  if (!isValidLensFov(fieldOfViewDegrees)) {
    throw new Error('Invalid INSV lens field of view.');
  }
  if (signal?.aborted) throw new Error('The INSV lens correction was cancelled.');
  await assertCurrentPair(pair);
  const hash = crypto
    .createHash('sha256')
    .update(
      JSON.stringify([THUMBNAIL_VERSION, pair.paths, pair.snapshots, pair.sampleTime, rotation, fieldOfViewDegrees])
    )
    .digest('hex');
  const name = `insv-${hash}.jpg`;
  const target = path.join(smallDir, name);
  await fs.promises.mkdir(smallDir, { recursive: true });
  if (await isValidThumbnail(target, signal)) {
    await assertCurrentPair(pair);
    if (signal?.aborted) throw new Error('The INSV lens correction was cancelled.');
    return name;
  }

  let image;
  try {
    const frames = [];
    for (const file of pair.paths) {
      frames.push(
        await runFfmpeg(
          [
            '-nostdin',
            '-v',
            'error',
            '-xerror',
            '-abort_on',
            'empty_output',
            '-threads',
            '2',
            '-ss',
            String(pair.sampleTime),
            '-an',
            '-i',
            file,
            '-map',
            '0:v:0',
            '-vf',
            `scale=${SOURCE_SIZE}:${SOURCE_SIZE}`,
            '-frames:v',
            '1',
            '-threads',
            '1',
            '-pix_fmt',
            'rgba',
            '-f',
            'rawvideo',
            'pipe:1',
          ],
          { encoding: 'buffer', signal }
        )
      );
    }
    if (signal?.aborted) throw new Error('The INSV lens correction was cancelled.');
    const pixels = projectInsvThumbnail(frames, SOURCE_SIZE, WIDTH, HEIGHT, rotation, fieldOfViewDegrees);
    if (signal?.aborted) throw new Error('The INSV lens correction was cancelled.');
    image = await runFfmpeg(
      [
        '-v',
        'error',
        '-xerror',
        '-abort_on',
        'empty_output',
        '-f',
        'rawvideo',
        '-pixel_format',
        'rgba',
        '-video_size',
        `${WIDTH}x${HEIGHT}`,
        '-i',
        'pipe:0',
        '-frames:v',
        '1',
        '-threads',
        '1',
        '-c:v',
        'mjpeg',
        '-f',
        'image2pipe',
        'pipe:1',
      ],
      { encoding: 'buffer', input: pixels, signal }
    );
  } catch (error) {
    if (signal?.aborted) throw new Error('The INSV lens correction was cancelled.');
    throw new Error('Unable to create the INSV panorama thumbnail. Check both lenses and ffmpeg.');
  }
  if (
    !Buffer.isBuffer(image) ||
    image.length < 4 ||
    image[0] !== 0xff ||
    image[1] !== 0xd8 ||
    image[image.length - 2] !== 0xff ||
    image[image.length - 1] !== 0xd9
  ) {
    throw new Error('FFmpeg did not produce a complete INSV thumbnail.');
  }

  const temporary = path.join(smallDir, `.${name}.${crypto.randomUUID()}.jpg`);
  let created = false;
  try {
    await fs.promises.writeFile(temporary, image, { flag: 'wx', mode: 0o600 });
    created = true;
    if (!(await isValidThumbnail(temporary, signal))) throw new Error('FFmpeg produced an invalid INSV thumbnail.');
    await assertCurrentPair(pair);
    if (signal?.aborted) throw new Error('The INSV lens correction was cancelled.');
    await renameWithRetry(temporary, target);
    created = false;
    return name;
  } finally {
    if (created) {
      await fs.promises.unlink(temporary).catch((error) => {
        if (error.code !== 'ENOENT') throw error;
      });
    }
  }
}

module.exports = { createInsvThumbnail };
