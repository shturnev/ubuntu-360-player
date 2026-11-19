const { spawnSync } = require('child_process');
const { buildInsta360Filter } = require('../../src/models/Media');
const mediaTools = require('../../src/models/mediaTools');

const orientation = { yaw: 0, pitch: 0, roll: 0 };
const size = 128;
const width = 360;
const height = 180;
const ffmpeg = mediaTools.ffmpeg();
const filterList = spawnSync(ffmpeg, ['-hide_banner', '-filters'], { encoding: 'utf8' });
const testWithFfmpeg = filterList.status === 0 && /\bv360\b/.test(filterList.stdout) ? test : test.skip;

function render(filter, pixels) {
  const result = spawnSync(
    ffmpeg,
    [
      '-v',
      'error',
      '-f',
      'rawvideo',
      '-pixel_format',
      'rgb24',
      '-video_size',
      `${size * 2}x${size}`,
      '-i',
      'pipe:0',
      '-vf',
      filter,
      '-frames:v',
      '1',
      '-threads',
      '1',
      '-pix_fmt',
      'rgb24',
      '-f',
      'rawvideo',
      'pipe:1',
    ],
    { input: pixels, maxBuffer: 2 * 1024 * 1024 }
  );
  if (result.status !== 0) throw new Error(result.stderr?.toString() || 'FFmpeg projection failed.');
  return result.stdout;
}

test('rejects invalid photo projection values before constructing an FFmpeg filter', () => {
  for (const value of [NaN, Infinity, '199', 179, 220.1, 200.01]) {
    expect(() => buildInsta360Filter(value, orientation)).toThrow(/invalid/i);
  }
  expect(() => buildInsta360Filter(199, { ...orientation, yaw: NaN })).toThrow(/invalid/i);
});

testWithFfmpeg('projects synthetic markers from both lenses and preserves the 199° baseline', () => {
  const pixels = Buffer.alloc(size * 2 * size * 3);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size * 2; x += 1) {
      const offset = (y * size * 2 + x) * 3;
      if (x < size) pixels[offset] = x * 2;
      else pixels[offset + 1] = (x - size) * 2;
    }
  }
  const dimensions = { width, height };
  const baseline = render(buildInsta360Filter(199, orientation, dimensions), pixels);
  const original = render(
    `v360=input=dfisheye:output=equirect:ih_fov=199:iv_fov=199:w=${width}:h=${height}:interp=lanczos:yaw=0:pitch=0:roll=0`,
    pixels
  );
  const adjusted = render(buildInsta360Filter(210, orientation, dimensions), pixels);
  expect(baseline).toEqual(original);
  expect(baseline).toHaveLength(width * height * 3);
  let firstLensChanges = 0;
  let secondLensChanges = 0;
  for (let offset = 0; offset < baseline.length; offset += 3) {
    if (baseline[offset] > 4 && Math.abs(baseline[offset] - adjusted[offset]) > 3) firstLensChanges += 1;
    if (baseline[offset + 1] > 4 && Math.abs(baseline[offset + 1] - adjusted[offset + 1]) > 3) secondLensChanges += 1;
  }
  expect(firstLensChanges).toBeGreaterThan(100);
  expect(secondLensChanges).toBeGreaterThan(100);
});
