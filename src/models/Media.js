const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile, spawn } = require('child_process');
const gm = require('gm');
const exifr = require('exifr');
const { getStorageRoot } = require('../config/env');

const getBigDir = () => path.join(getStorageRoot(), 'static', 'big');
const sendMediaResult = (win, result, onResult) => {
  if (onResult) {
    onResult(result);
  } else if (win && win.webContents) {
    win.webContents.send('read-media-file', result);
  }
};

class Media {
  static saveImage(filePath, win, onResult) {
    const newFileName = getNewFileName(filePath);
    createLink(filePath, newFileName);

    const thumpName = newFileName;
    const thumpPath = path.join(getStorageRoot(), 'static', 'small', thumpName);
    const res = {
      error: null,
      type: 'image',
      origPath: filePath,
      thumpName,
      bigName: newFileName,
    };

    try {
      fs.statSync(thumpPath);
      sendMediaResult(win, res, onResult);
      return res;
    } catch (e) {
      gm(filePath)
        .resize(450)
        .autoOrient()
        .write(thumpPath, (err) => {
          if (err) {
            res.error = err;
          }
          sendMediaResult(win, res, onResult);
        });
      return res;
    }
  }

  static saveVideo(filePath, win, onResult) {
    const newFileName = getPreferredVideoName(filePath);
    createLink(filePath, newFileName);

    const thumpName = path.parse(newFileName).name + '.jpg';
    const thumpPath = path.join(getStorageRoot(), 'static', 'small', thumpName);
    const res = {
      error: null,
      type: 'video',
      origPath: filePath,
      thumpName,
      bigName: newFileName,
    };

    try {
      fs.statSync(thumpPath);
      sendMediaResult(win, res, onResult);
      return res;
    } catch (e) {
      execFile(
        'ffmpeg',
        ['-i', filePath, '-s', '450x225', '-vframes', '1', thumpPath, '-y'],
        (error, stdout, stderr) => {
          if (error) {
            res.error = error;
          }
          if (stderr && stderr.search('deprecated pixel format used') === -1) {
            res.error = { message: stderr };
          }
          sendMediaResult(win, res, onResult);
        }
      );
      return res;
    }
  }

  static probeVideo(filePath) {
    return new Promise((resolve, reject) => {
      execFile(
        'ffprobe',
        ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', filePath],
        (error, stdout) => {
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
        }
      );
    });
  }

  static async getMetadata(filePath, type) {
    if (type === 'image') {
      try {
        return formatImageMetadata((await exifr.parse(filePath, { xmp: true, icc: false })) || {});
      } catch (error) {
        throw new Error('Unable to read image metadata.');
      }
    }

    if (type === 'video') {
      try {
        return formatVideoMetadata(await Media.probeVideoMetadata(filePath));
      } catch (error) {
        throw new Error('Unable to read video metadata. Make sure ffprobe is available and the file can be read.');
      }
    }

    throw new Error('Unsupported media type.');
  }

  static probeVideoMetadata(filePath) {
    return new Promise((resolve, reject) => {
      execFile(
        'ffprobe',
        ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', filePath],
        (error, stdout) => {
          if (error) return reject(error);
          try {
            resolve(JSON.parse(stdout || '{}'));
          } catch (parseError) {
            reject(parseError);
          }
        }
      );
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
            '-i',
            filePath,
            '-map',
            '0:v:0',
            ...(audioStreams.length ? ['-map', '0:a:0'] : []),
            '-c:v',
            'libx264',
            '-pix_fmt',
            'yuv420p',
            '-c:a',
            'aac',
            '-movflags',
            '+faststart',
            '-progress',
            'pipe:1',
            '-nostats',
            outputPath,
          ];

          const startedAt = Date.now();
          let conversionDone = false;
          let lastProgressPercent = -1;

          const sendProgress = (payload) => {
            if (win && win.webContents) {
              win.webContents.send('video-conversion-progress', {
                ...payload,
                origPath: filePath,
                bigName: outputName,
                filePath,
                outputPath,
              });
            }
          };

          const updateProgress = (nextPercent, elapsedMs, etaMs, message) => {
            const safePercent = Number.isFinite(nextPercent) ? Math.max(0, Math.min(100, nextPercent)) : 0;
            if (Math.abs(safePercent - lastProgressPercent) < 0.1 && lastProgressPercent >= 0 && safePercent < 100) {
              return;
            }
            lastProgressPercent = safePercent;
            sendProgress({
              active: true,
              status: 'running',
              percent: Number(safePercent.toFixed(1)),
              elapsedMs,
              etaMs,
              message,
            });
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
              message,
            });
            reject(new Error(message));
          };

          child.stdout.on('data', (chunk) => {
            const text = String(chunk);
            outputText += text;
            const progress = parseFfmpegProgress(text, duration, startedAt);
            if (progress) {
              updateProgress(
                progress.percent,
                progress.elapsedMs,
                progress.etaMs,
                'Converting video for 360° playback…'
              );
            }
          });

          child.stderr.on('data', (chunk) => {
            const text = String(chunk);
            outputText += text;
            const progress = parseFfmpegProgress(text, duration, startedAt);
            if (progress) {
              updateProgress(
                progress.percent,
                progress.elapsedMs,
                progress.etaMs,
                'Converting video for 360° playback…'
              );
            }
          });

          child.on('error', (error) =>
            finalizeFailure(error && error.message ? error.message : 'ffmpeg is not available.')
          );
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

              const originalBigPath = path.join(getBigDir(), getNewFileName(filePath));
              if (originalBigPath !== outputPath && fs.existsSync(originalBigPath)) {
                try {
                  fs.unlinkSync(originalBigPath);
                } catch (cleanupError) {
                  // Ignore cleanup failures so the conversion result remains valid.
                }
              }

              const elapsedMs = Date.now() - startedAt;
              sendProgress({
                active: false,
                status: 'done',
                percent: 100,
                elapsedMs,
                etaMs: 0,
                message: 'Converted for 360° playback.',
              });

              resolve({
                success: true,
                origPath: filePath,
                bigName: outputName,
                outputPath,
                percent: 100,
                elapsedMs,
                etaMs: 0,
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
              message,
            });
          }
          reject(error);
        });
    });
  }
}

function parseFfmpegProgress(text, durationSeconds, startedAtMs) {
  if (!text || typeof text !== 'string') return null;

  const timeMatch = /time=(\d{2}):(\d{2}):(\d{2}\.\d+)/i.exec(text);
  const outTimeMatch = /out_time_ms=(\d+)/i.exec(text);

  const elapsedMs = Date.now() - startedAtMs;
  if (timeMatch) {
    const [, hours, minutes, seconds] = timeMatch;
    const totalSeconds = Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds);
    const durationMs = durationSeconds > 0 ? Number(durationSeconds) * 1000 : null;
    const percent = durationMs ? Math.max(0, Math.min(100, (totalSeconds / (durationSeconds || 1)) * 100)) : null;
    const etaMs =
      durationMs && totalSeconds > 0
        ? Math.max(0, Math.round((durationMs - totalSeconds * 1000) * (elapsedMs / Math.max(totalSeconds * 1000, 1))))
        : null;
    return { percent: percent ?? 0, elapsedMs, etaMs };
  }

  if (outTimeMatch) {
    const outTimeMs = Number(outTimeMatch[1]);
    const durationMs = durationSeconds > 0 ? Number(durationSeconds) * 1000 : null;
    const percent = durationMs ? Math.max(0, Math.min(100, (outTimeMs / durationMs) * 100)) : null;
    const etaMs =
      durationMs && outTimeMs > 0
        ? Math.max(0, Math.round((durationMs - outTimeMs) * (elapsedMs / Math.max(outTimeMs, 1))))
        : null;
    return { percent: percent ?? 0, elapsedMs, etaMs };
  }

  return null;
}

function entry(key, label, value) {
  if (value === undefined || value === null || String(value).trim() === '') return null;
  return { key, label, value: String(value) };
}

function compactEntries(entries) {
  const keys = new Set();
  return entries.filter((item) => item && !keys.has(item.key) && keys.add(item.key));
}

function formatImageMetadata(metadata = {}) {
  const width = metadata.ExifImageWidth || metadata.ImageWidth || metadata.PixelXDimension;
  const height = metadata.ExifImageHeight || metadata.ImageHeight || metadata.PixelYDimension;
  const date = metadata.DateTimeOriginal || metadata.CreateDate || metadata.ModifyDate;
  const location = metadata.Location || metadata.City || formatCoordinates(metadata.latitude, metadata.longitude);
  return compactEntries([
    entry('dimensions', 'Dimensions', width && height ? `${width} × ${height}` : null),
    entry('orientation', 'Orientation', metadata.Orientation),
    entry('date-taken', 'Date taken', formatDate(date)),
    entry('camera-make', 'Camera make', metadata.Make),
    entry('camera-model', 'Camera model', metadata.Model),
    entry('lens', 'Lens', metadata.LensModel),
    entry('exposure', 'Exposure', formatExposure(metadata.ExposureTime)),
    entry('aperture', 'Aperture', metadata.FNumber ? `f/${metadata.FNumber}` : null),
    entry('iso', 'ISO', metadata.ISO),
    entry('focal-length', 'Focal length', metadata.FocalLength ? `${metadata.FocalLength} mm` : null),
    entry('software', 'Software', metadata.Software),
    entry('copyright', 'Copyright', metadata.Copyright),
    entry('title', 'Title', metadata.Title || metadata['XMP:Title']),
    entry('location', 'Location', location),
  ]);
}

function formatVideoMetadata(metadata = {}) {
  const format = metadata.format || {};
  const streams = Array.isArray(metadata.streams) ? metadata.streams : [];
  const video = streams.find((stream) => stream.codec_type === 'video') || {};
  const audio = streams.find((stream) => stream.codec_type === 'audio') || {};
  const tags = { ...(format.tags || {}), ...(video.tags || {}) };
  return compactEntries([
    entry('format', 'Format', format.format_long_name || format.format_name),
    entry('duration', 'Duration', formatDuration(format.duration)),
    entry('dimensions', 'Dimensions', video.width && video.height ? `${video.width} × ${video.height}` : null),
    entry('video-codec', 'Video codec', video.codec_long_name || video.codec_name),
    entry('frame-rate', 'Frame rate', formatFrameRate(video.avg_frame_rate) || formatFrameRate(video.r_frame_rate)),
    entry('video-bitrate', 'Video bitrate', formatBitrate(video.bit_rate)),
    entry('audio-codec', 'Audio codec', audio.codec_long_name || audio.codec_name),
    entry(
      'audio-channels',
      'Audio channels',
      audio.channels ? `${audio.channels}${audio.channel_layout ? ` (${audio.channel_layout})` : ''}` : null
    ),
    entry('audio-sample-rate', 'Audio sample rate', audio.sample_rate ? `${audio.sample_rate} Hz` : null),
    entry('audio-bitrate', 'Audio bitrate', formatBitrate(audio.bit_rate)),
    entry('creation-date', 'Created', formatDate(tags.creation_time)),
    entry('title', 'Title', tags.title),
    entry('location', 'Location', tags.location || tags['com.apple.quicktime.location.ISO6709']),
  ]);
}

function formatDate(value) {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime()))
    return value
      .toISOString()
      .replace('T', ' ')
      .replace(/\.\d{3}Z$/, ' UTC');
  return String(value);
}

function formatCoordinates(latitude, longitude) {
  const lat = Number(latitude);
  const lon = Number(longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;

  const formatCoordinate = (value, positiveDirection, negativeDirection) =>
    `${Math.abs(value).toFixed(6)}° ${value >= 0 ? positiveDirection : negativeDirection}`;
  return `${formatCoordinate(lat, 'N', 'S')}, ${formatCoordinate(lon, 'E', 'W')}`;
}

function formatExposure(value) {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) return value || null;
  const reciprocal = 1 / seconds;
  const roundedReciprocal = Math.round(reciprocal);
  if (seconds < 1 && Math.abs(reciprocal - roundedReciprocal) < 1e-9) {
    return `1/${roundedReciprocal} s`;
  }
  return `${seconds} s`;
}

function formatDuration(value) {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds < 0) return null;
  const roundedSeconds = Math.round(seconds * 10) / 10;
  const hours = Math.floor(roundedSeconds / 3600);
  const minutes = Math.floor((roundedSeconds % 3600) / 60);
  const rawRemaining = String((roundedSeconds % 60).toFixed(roundedSeconds % 1 ? 1 : 0));
  const remaining = Number(rawRemaining) < 10 ? `0${rawRemaining}` : rawRemaining;
  return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${remaining}` : `${minutes}:${remaining}`;
}

function formatFrameRate(value) {
  if (!value) return null;
  const [numerator, denominator] = String(value).split('/').map(Number);
  const rate = denominator ? numerator / denominator : numerator;
  return Number.isFinite(rate) && rate > 0 ? `${Number(rate.toFixed(3))} fps` : null;
}

function formatBitrate(value) {
  const bits = Number(value);
  if (!Number.isFinite(bits) || bits <= 0) return null;
  return bits >= 1000000 ? `${(bits / 1000000).toFixed(1)} Mbps` : `${Math.round(bits / 1000)} kbps`;
}

function createLink(origPath, newFileName) {
  const linksDir = getBigDir();
  const linkPath = path.join(linksDir, newFileName);

  fs.mkdirSync(linksDir, { recursive: true });

  if (newFileName !== getNewFileName(origPath)) {
    const rawLinkPath = path.join(linksDir, getNewFileName(origPath));
    if (fs.existsSync(rawLinkPath)) {
      try {
        fs.unlinkSync(rawLinkPath);
      } catch (error) {
        // Ignore stale duplicate links while keeping the converted output authoritative.
      }
    }
    return;
  }

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
  return `${parsed.name}-${stats.size}-${getPathHash(origPath)}-h264${parsed.ext}`;
}

function getPreferredVideoName(origPath) {
  const convertedName = getConvertedVideoName(origPath);
  const convertedLinkPath = path.join(getBigDir(), convertedName);

  fs.mkdirSync(getBigDir(), { recursive: true });

  if (fs.existsSync(convertedLinkPath)) {
    return convertedName;
  }

  return getNewFileName(origPath);
}

function getNewFileName(origPath) {
  const stats = fs.statSync(origPath);
  const parsed = path.parse(origPath);

  return `${parsed.name}-${stats.size}-${getPathHash(origPath)}${parsed.ext}`;
}

function getPathHash(origPath) {
  return crypto.createHash('sha256').update(origPath).digest('hex').slice(0, 12);
}

module.exports = { Media, formatImageMetadata, formatVideoMetadata };
Object.defineProperty(module.exports, 'default', {
  value: Media,
  enumerable: false,
});
