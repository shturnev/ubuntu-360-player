const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const { Media } = require('../../src/models/Media');
const { validateInsvPair } = require('../../src/models/insvPair');

const mediaTools = require('../../src/models/mediaTools');

const ffmpegPath = mediaTools.ffmpeg();
const ffprobePath = mediaTools.ffprobe();
const encoders = spawnSync(ffmpegPath, ['-hide_banner', '-encoders'], { encoding: 'utf8' });
const hasFfmpeg = encoders.status === 0 && /\blibx264\b/.test(encoders.stdout);
const hasFfprobe = spawnSync(ffprobePath, ['-version'], { stdio: 'ignore' }).status === 0;
const testWithFfmpeg = hasFfmpeg && hasFfprobe ? test : test.skip;

testWithFfmpeg(
  'compares source frame timestamps after seeking instead of normalized seek offsets',
  async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'insv-timestamps-'));
    const base = path.join(directory, 'base.mp4');
    const matching = path.join(directory, 'matching.mp4');
    const shifted = path.join(directory, 'shifted.mp4');
    try {
      execFileSync(ffmpegPath, [
        '-v',
        'error',
        '-f',
        'lavfi',
        '-i',
        'testsrc=size=64x64:rate=30',
        '-t',
        '2',
        '-c:v',
        'libx264',
        '-pix_fmt',
        'yuv420p',
        base,
      ]);
      fs.copyFileSync(base, matching);
      execFileSync(ffmpegPath, [
        '-v',
        'error',
        '-itsoffset',
        '0.02',
        '-i',
        base,
        '-map',
        '0:v:0',
        '-c',
        'copy',
        shifted,
      ]);

      const originalTime = await Media.verifyInsvVideo(base, 1);
      const shiftedTime = await Media.verifyInsvVideo(shifted, 1);
      expect(originalTime).toBeCloseTo(1, 3);
      expect(shiftedTime - originalTime).toBeGreaterThan(0.5 / 30);
      expect(shiftedTime - originalTime).toBeLessThan(1 / 30);
      await expect(validateInsvPair([base, matching], Media.probeVideo, Media.verifyInsvVideo)).resolves.toBeDefined();
      await expect(validateInsvPair([base, shifted], Media.probeVideo, Media.verifyInsvVideo)).rejects.toThrow(
        'matching decoded frame timestamps'
      );
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  },
  30000
);
