// Verifies that the media tools resolved by mediaTools.js exist and have the required capabilities.
// Run from a checkout:  node electron/smoke-tools.js
// Run against a packaged build (PowerShell):
//   $env:ELECTRON_RUN_AS_NODE=1; & ".\dist_electron\win-unpacked\360 Media Viewer.exe" ".\dist_electron\win-unpacked\resources\app.asar\electron\smoke-tools.js"
const { execFileSync } = require('child_process');
const os = require('os');
const path = require('path');
const fs = require('fs');
const mediaTools = require('../src/models/mediaTools');

function run(command, args) {
  return execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 60000 });
}

async function main() {
  const results = [];
  const check = async (name, fn) => {
    try {
      results.push({ name, ok: true, detail: await fn() });
    } catch (error) {
      results.push({ name, ok: false, detail: error.message });
    }
  };

  await check('ffmpeg encoders (libx264, aac)', () => {
    const encoders = run(mediaTools.ffmpeg(), ['-hide_banner', '-encoders']);
    for (const name of ['libx264', 'aac']) {
      if (!new RegExp(`\\b${name}\\b`).test(encoders)) throw new Error(`${name} encoder is missing`);
    }
    return mediaTools.ffmpeg();
  });
  await check('ffmpeg filter v360', () => {
    if (!/\bv360\b/.test(run(mediaTools.ffmpeg(), ['-hide_banner', '-filters']))) throw new Error('v360 is missing');
  });
  await check('ffprobe', () => run(mediaTools.ffprobe(), ['-version']).split('\n')[0]);
  await check('exiftool', () => {
    const { command, args } = mediaTools.exiftool(['-ver']);
    return run(command, args).trim();
  });
  if (mediaTools.bundled) {
    await check('sharp thumbnail', async () => {
      const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'smoke-sharp-'));
      try {
        const sharp = require('sharp');
        const input = path.join(directory, 'in.png');
        const output = path.join(directory, 'out.jpg');
        await sharp({ create: { width: 900, height: 450, channels: 3, background: '#336699' } }).toFile(input);
        await sharp(input).rotate().resize({ width: 450 }).toFile(output);
        const { width } = await sharp(output).metadata();
        if (width !== 450) throw new Error(`unexpected width ${width}`);
      } finally {
        fs.rmSync(directory, { recursive: true, force: true });
      }
    });
  }

  for (const { name, ok, detail } of results)
    console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${detail ? ` - ${detail}` : ''}`);
  return results.every((result) => result.ok);
}

main().then(
  (ok) => process.exit(ok ? 0 : 1),
  (error) => {
    console.error(error);
    process.exit(1);
  }
);
