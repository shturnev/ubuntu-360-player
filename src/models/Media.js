const fs = require('fs');
const path = require('path');
const os = require('os');
const { exec, execFile, spawn } = require('child_process');
const gm = require('gm');

const getStorageRoot = () => {
  const base = process.env.SHT_VR_HOME || process.env.HOME || os.homedir();
  return path.join(base, '.sht-vr-player');
};

const getBigDir = () => path.join(getStorageRoot(), 'static', 'big');

class Media {
  static saveImage(filePath, win) {
    const newFileName = getNewFileName(filePath);
    createLink(filePath, newFileName);

    const thumpName = newFileName;
    const thumpPath = path.join(getStorageRoot(), 'static', 'small', thumpName);
    const res = {
      error: null,
      type: 'image',
      origPath: filePath,
      thumpName,
      bigName: newFileName
    };

    try {
      fs.statSync(thumpPath);
      if (win && win.webContents) win.webContents.send('read-media-file', res);
      return res;
    } catch (e) {
      gm(filePath).resize(450).autoOrient().write(thumpPath, (err) => {
        if (err) {
          res.error = err;
        }
        if (win && win.webContents) win.webContents.send('read-media-file', res);
      });
      return res;
    }
  }

  static saveVideo(filePath, win) {
    const newFileName = getNewFileName(filePath);
    createLink(filePath, newFileName);

    const thumpName = path.parse(newFileName).name + '.jpg';
    const thumpPath = path.join(getStorageRoot(), 'static', 'small', thumpName);
    const res = {
      error: null,
      type: 'video',
      origPath: filePath,
      thumpName,
      bigName: newFileName
    };

    try {
      fs.statSync(thumpPath);
      if (win && win.webContents) win.webContents.send('read-media-file', res);
      return res;
    } catch (e) {
      execFile('ffmpeg', ['-i', filePath, '-s', '450x225', '-vframes', '1', thumpPath, '-y'], (error, stdout, stderr) => {
        if (error) {
          res.error = error;
        }
        if (stderr && stderr.search('deprecated pixel format used') === -1) {
          res.error = { message: stderr };
        }
        if (win && win.webContents) win.webContents.send('read-media-file', res);
      });
      return res;
    }
  }

  static probeVideo(filePath) {
    return new Promise((resolve, reject) => {
      execFile('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', filePath], (error, stdout) => {
        if (error) {
          reject(error);
          return;
        }

        try {
          const parsed = JSON.parse(stdout || '{}');
          resolve(parsed);
        } catch (parseError) {
          reject(parseError);
        }
      });
    });
  }

  static convertVideoFor360(filePath, win) {
    return new Promise((resolve, reject) => {
      const outputName = getConvertedVideoName(filePath);
      const outputPath = path.join(getBigDir(), outputName);

      fs.mkdirSync(getBigDir(), { recursive: true });

      Media.probeVideo(filePath)
        .then((metadata) => {
          const streams = Array.isArray(metadata && metadata.streams) ? metadata.streams : [];
          const duration = Number(metadata && metadata.format && metadata.format.duration) || 0;
          const audioStreams = streams.filter((stream) => stream.codec_type === 'audio');
          const videoStreams = streams.filter((stream) => stream.codec_type === 'video');

          if (!videoStreams.length) {
            throw new Error('This file has no video stream to convert.');
          }

          const ffmpegArgs = [
            '-i', filePath,
            '-map', '0:v:0',
            ...(audioStreams.length ? ['-map', '0:a:0'] : []),
            '-c:v', 'libx264',
            '-pix_fmt', 'yuv420p',
            '-c:a', 'aac',
            '-movflags', '+faststart',
            '-progress', 'pipe:1',
            '-nostats',
            outputPath
          ];

          const startedAt = Date.now();
          let lastOutputMs = 0;
          let conversionDone = false;

          const sendProgress = (payload) => {
            if (win && win.webContents) {
              win.webContents.send('video-conversion-progress', {
                ...payload,
                origPath: filePath,
                bigName: outputName,
                filePath,
                outputPath
              });
            }
          };

          const child = spawn('ffmpeg', ffmpegArgs);
          let outputText = '';

          const finalizeFailure = (message) => {
            if (fs.existsSync(outputPath)) {
              fs.unlinkSync(outputPath);
            }
            sendProgress({
              active: false,
              status: 'error',
              percent: 0,
              elapsedMs: Date.now() - startedAt,
              etaMs: null,
              message
            });
            reject(new Error(message));
          };

          child.stdout.on('data', (chunk) => {
            outputText += String(chunk);
          });

          child.stderr.on('data', (chunk) => {
            outputText += String(chunk);
            const text = String(chunk);
            const match = /out_time_ms=(\d+)/.exec(text);
            if (!match) return;

            const outTimeMs = Number(match[1]);
            const elapsedMs = Date.now() - startedAt;
            const progressPercent = duration > 0 ? Math.max(0, Math.min(100, (outTimeMs / (duration * 1000000)) * 100)) : 0;
            lastOutputMs = outTimeMs;

            sendProgress({
              active: true,
              status: 'running',
              percent: Number(progressPercent.toFixed(1)),
              elapsedMs,
              etaMs: duration > 0 && outTimeMs > 0
                ? Math.round(((duration * 1000) - (outTimeMs / 1000)) * (elapsedMs / Math.max(outTimeMs / 1000, 1)))
                : null,
              message: 'Converting video for 360° playback…'
            });
          });

          child.on('error', (error) => finalizeFailure(error && error.message ? error.message : 'ffmpeg is not available.'));
          child.on('close', (code) => {
            if (conversionDone) return;
            conversionDone = true;

            if (code !== 0) {
              finalizeFailure(outputText || 'ffmpeg conversion failed.');
              return;
            }

            try {
              if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size === 0) {
                throw new Error('The converted video was not created.');
              }

              const elapsedMs = Date.now() - startedAt;
              sendProgress({
                active: false,
                status: 'done',
                percent: 100,
                elapsedMs,
                etaMs: 0,
                message: 'Converted for 360° playback.'
              });

              resolve({
                success: true,
                origPath: filePath,
                bigName: outputName,
                outputPath,
                percent: 100,
                elapsedMs,
                etaMs: 0
              });
            } catch (error) {
              finalizeFailure(error && error.message ? error.message : 'Unable to save the converted video.');
            }
          });
        })
        .catch((error) => {
          const message = error && error.message ? error.message : 'Unable to inspect video codecs.';
          if (win && win.webContents) {
            win.webContents.send('video-conversion-result', {
              success: false,
              origPath: filePath,
              bigName: outputName,
              message
            });
          }
          reject(error);
        });
    });
  }
}

function createLink(origPath, newFileName) {
  const linksDir = getBigDir();
  const linkPath = path.join(linksDir, newFileName);

  fs.mkdirSync(linksDir, { recursive: true });

  try {
    fs.statSync(linkPath);
    return;
  } catch (e) {
    fs.symlinkSync(origPath, linkPath);
  }
}

function getConvertedVideoName(origPath) {
  const stats = fs.statSync(origPath);
  const parsed = path.parse(origPath);
  return `${parsed.name}-${stats.size}-h264${parsed.ext}`;
}

function getNewFileName(origPath) {
  const stats = fs.statSync(origPath);
  const parsed = path.parse(origPath);

  return parsed.name + '-' + stats.size + parsed.ext;
}

module.exports = { Media };
Object.defineProperty(module.exports, 'default', {
  value: Media,
  enumerable: false
});