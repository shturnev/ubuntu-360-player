const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile, spawn } = require('child_process');
const gm = require('gm');
const exifr = require('exifr');
const { getStorageRoot } = require('../config/env');
const exiftoolPath = require('exiftool-vendored.pl').replace(/\.asar([/\\])/, '.asar.unpacked$1');
const exifQueue = [];
let activeExifJobs = 0;

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

  static async saveInsta360Image(filePath, win, onResult) {
    const bigName = getInsta360ImageName(filePath);
    const thumpName = bigName;
    const bigPath = path.join(getBigDir(), bigName);
    const thumpPath = path.join(getStorageRoot(), 'static', 'small', thumpName);
    const res = {
      error: null,
      type: 'image',
      origPath: filePath,
      thumpName,
      bigName,
    };

    fs.mkdirSync(path.dirname(bigPath), { recursive: true });
    fs.mkdirSync(path.dirname(thumpPath), { recursive: true });

    try {
      const hadBigCache = isUsableFile(bigPath);
      if (!hadBigCache) {
        removeFileIfPresent(bigPath);
        await convertInsta360Image(filePath, bigPath);
      }

      if (!isUsableFile(thumpPath)) {
        removeFileIfPresent(thumpPath);
        await createImageThumbnail(bigPath, thumpPath);
      }

      sendMediaResult(win, res, onResult);
      return res;
    } catch (error) {
      removeFileIfPresent(thumpPath);
      if (!isUsableFile(bigPath) || !isJpegFile(bigPath)) {
        removeFileIfPresent(bigPath);
      }
      res.error = error instanceof Error ? error : new Error('Unable to convert Insta360 photo.');
      sendMediaResult(win, res, onResult);
      return res;
    }
  }

  static async saveOrientationCorrection(filePath, orientation) {
    const bigName =
      path.extname(filePath).toLowerCase() === '.insp' ? getInsta360ImageName(filePath) : getNewFileName(filePath);
    const bigPath = path.join(getBigDir(), bigName);
    const thumpPath = path.join(getStorageRoot(), 'static', 'small', bigName);
    const suffix = `${process.pid}-${Date.now()}`;
    const extension = path.extname(bigPath).toLowerCase();
    const renderedPath = `${bigPath}.${suffix}${extension}`;
    const thumbnailPath = `${thumpPath}.${suffix}${extension}`;

    if (!isUsableFile(bigPath)) {
      throw new Error('The rendered panorama is no longer available.');
    }

    try {
      await renderEquirectangularOrientation(bigPath, renderedPath, orientation);
      await queueExifTask(() => copyExif(filePath, renderedPath));
      await createImageThumbnail(renderedPath, thumbnailPath);
      replaceCachePair(bigPath, renderedPath, thumpPath, thumbnailPath, suffix);
      return { bigName };
    } catch (error) {
      removeFileIfPresent(renderedPath);
      removeFileIfPresent(thumbnailPath);
      throw error instanceof Error ? error : new Error('Unable to save orientation correction.');
    }
  }

  static async syncCachedExif(filePath, bigPath, isCurrent) {
    return queueExifTask(async () => {
      if (!isCurrent()) return;
      const originalStat = await fs.promises.lstat(bigPath);
      if (originalStat.isSymbolicLink()) return;
      if (!originalStat.isFile()) throw new Error('The cached media file is invalid.');

      const tempPath = `${bigPath}.${crypto.randomUUID()}${path.extname(bigPath)}`;
      let created = false;
      try {
        await fs.promises.copyFile(bigPath, tempPath, fs.constants.COPYFILE_EXCL);
        created = true;
        await copyExif(filePath, tempPath);
        const currentStat = await fs.promises.lstat(bigPath);
        if (
          !isCurrent() ||
          !currentStat.isFile() ||
          currentStat.dev !== originalStat.dev ||
          currentStat.ino !== originalStat.ino ||
          currentStat.size !== originalStat.size ||
          currentStat.mtimeMs !== originalStat.mtimeMs
        ) {
          throw new Error('The cached media file changed during import.');
        }
        await fs.promises.rename(tempPath, bigPath);
        created = false;
      } finally {
        if (created) await fs.promises.unlink(tempPath);
      }
    });
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

  static verifyInsvVideo(filePath, sampleTime) {
    return new Promise((resolve, reject) => {
      execFile(
        'ffmpeg',
        [
          '-nostdin',
          '-v',
          'info',
          '-xerror',
          '-abort_on',
          'empty_output',
          '-threads',
          '2',
          '-ss',
          String(sampleTime),
          '-i',
          filePath,
          '-map',
          '0:v:0',
          '-vf',
          'showinfo',
          '-frames:v',
          '1',
          '-f',
          'null',
          '-',
        ],
        { timeout: 30000, maxBuffer: 256 * 1024 },
        (error, _stdout, stderr) => {
          if (error) {
            reject(new Error('Unable to decode an INSV lens. Check that ffmpeg is available and the video is valid.'));
            return;
          }
          const match = /\bn:\s*0\s+pts:\s*-?\d+\s+pts_time:([+-]?[\d.eE+-]+)/.exec(stderr || '');
          const timestamp = match ? Number(match[1]) : NaN;
          if (!Number.isFinite(timestamp)) {
            reject(new Error('Unable to verify an INSV frame timestamp.'));
            return;
          }
          resolve(timestamp);
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

function queueExifTask(task) {
  return new Promise((resolve, reject) => {
    exifQueue.push({ task, resolve, reject });
    runExifQueue();
  });
}

function runExifQueue() {
  while (activeExifJobs < 4 && exifQueue.length) {
    const { task, resolve, reject } = exifQueue.shift();
    activeExifJobs += 1;
    Promise.resolve()
      .then(task)
      .then(resolve, reject)
      .finally(() => {
        activeExifJobs -= 1;
        runExifQueue();
      });
  }
}

function copyExif(sourcePath, destinationPath) {
  return new Promise((resolve, reject) => {
    execFile(
      'perl',
      [exiftoolPath, '-overwrite_original', '-EXIF:all=', '-TagsFromFile', sourcePath, '-EXIF', destinationPath],
      (error, _stdout, stderr) => {
        const warnings = String(stderr || '')
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean);
        const benignWarnings = [
          'Unrecognized MakerNotes',
          'Use ExtractEmbedded option to extract timed metadata from Insta360 trailer',
        ];
        const unexpected = warnings.filter((line) => {
          if (line.startsWith('Warning: No writable tags set from ')) return false;
          const benign = benignWarnings.find(
            (message) => line === `Warning: [minor] ${message}` || line.startsWith(`Warning: [minor] ${message} - `)
          );
          if (benign) {
            console.warn(`ExifTool: ${benign}`);
            return false;
          }
          return true;
        });
        if (error || unexpected.length) {
          console.error(
            'ExifTool could not preserve EXIF metadata:',
            error?.code || error?.message || unexpected.join('\n')
          );
          reject(
            new Error(
              error?.code === 'ENOENT'
                ? 'Unable to preserve EXIF metadata: Perl is not installed or not available in PATH.'
                : 'Unable to preserve EXIF metadata.'
            )
          );
          return;
        }
        resolve();
      }
    );
  });
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

async function convertInsta360Image(filePath, outputPath) {
  const orientation = await getInsta360Orientation(filePath);
  const filter = [
    'v360=input=dfisheye:output=equirect:ih_fov=199:iv_fov=199:w=6080:h=3040:interp=lanczos',
    `yaw=${orientation.yaw}`,
    `pitch=${orientation.pitch}`,
    `roll=${orientation.roll}`,
  ].join(':');
  return new Promise((resolve, reject) => {
    const child = spawn('ffmpeg', [
      '-y',
      '-v',
      'error',
      '-i',
      filePath,
      '-vf',
      filter,
      '-frames:v',
      '1',
      '-q:v',
      '1',
      outputPath,
    ]);
    let output = '';
    let settled = false;

    const fail = (error) => {
      if (settled) return;
      settled = true;
      removeFileIfPresent(outputPath);
      reject(error instanceof Error ? error : new Error(String(error)));
    };

    child.stderr.on('data', (chunk) => {
      output += String(chunk);
    });
    child.on('error', () => fail(new Error('ffmpeg is not available for Insta360 photo conversion.')));
    child.on('close', (code) => {
      if (settled) return;
      if (code !== 0) {
        fail(new Error(output || 'ffmpeg failed to convert the Insta360 photo.'));
        return;
      }
      if (!isUsableFile(outputPath) || !isJpegFile(outputPath)) {
        fail(new Error('ffmpeg did not create a valid Insta360 panorama.'));
        return;
      }
      settled = true;
      resolve();
    });
  });
}

function renderEquirectangularOrientation(inputPath, outputPath, orientation) {
  const filter = [
    'v360=input=equirect:output=equirect',
    `yaw=${orientation.yaw}`,
    `pitch=${-orientation.pitch}`,
    `roll=${orientation.roll}`,
    'rorder=ryp',
    'interp=lanczos',
  ].join(':');

  const isJpeg = ['.jpg', '.jpeg'].includes(path.extname(outputPath).toLowerCase());
  return new Promise((resolve, reject) => {
    const child = spawn('ffmpeg', [
      '-y',
      '-v',
      'error',
      '-i',
      inputPath,
      '-vf',
      filter,
      '-frames:v',
      '1',
      ...(isJpeg ? ['-q:v', '1'] : []),
      outputPath,
    ]);
    let output = '';

    child.stderr.on('data', (chunk) => {
      output += String(chunk);
    });
    child.on('error', () => reject(new Error('ffmpeg is not available for orientation correction.')));
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(output || 'ffmpeg failed to render orientation correction.'));
        return;
      }
      if (!isUsableFile(outputPath) || !hasExpectedImageFormat(outputPath)) {
        reject(new Error('ffmpeg did not create a valid corrected panorama.'));
        return;
      }
      resolve();
    });
  });
}

function replaceCachePair(bigPath, renderedPath, thumpPath, thumbnailPath, suffix) {
  const entries = [
    { destination: bigPath, replacement: renderedPath, backup: `${bigPath}.${suffix}.backup` },
    { destination: thumpPath, replacement: thumbnailPath, backup: `${thumpPath}.${suffix}.backup` },
  ];

  try {
    for (const entry of entries) {
      entry.hadDestination = fs.existsSync(entry.destination);
      if (entry.hadDestination) {
        fs.renameSync(entry.destination, entry.backup);
        entry.backupCreated = true;
      }
      fs.renameSync(entry.replacement, entry.destination);
      entry.replaced = true;
    }
  } catch (error) {
    for (const entry of [...entries].reverse()) {
      if (entry.replaced) {
        removeFileIfPresent(entry.destination);
      }
      if (entry.backupCreated) {
        fs.renameSync(entry.backup, entry.destination);
      }
    }
    throw error;
  }

  entries.forEach((entry) => {
    if (entry.backupCreated) removeFileIfPresent(entry.backup);
  });
}

async function getInsta360Orientation(filePath) {
  try {
    const metadata = await exifr.parse(filePath, { makerNote: true, xmp: false, icc: false });
    const makerNoteSample = parseMakerNoteImuSample(metadata?.MakerNote ?? metadata?.makerNote);
    const imuSample = makerNoteSample && readInsta360ImuSnapshot(filePath, makerNoteSample);
    if (imuSample) return imuSnapshotToV360Orientation(imuSample);
  } catch (error) {
    // Insta360 photos remain viewable with the camera's native upside-down correction.
  }

  return { yaw: 0, pitch: 0, roll: 180 };
}

function parseMakerNoteImuSample(makerNote) {
  if (!makerNote || typeof makerNote.length !== 'number') return null;

  const text = Buffer.from(makerNote).toString('ascii').split('\0')[0];
  const values = text.split('_').slice(0, 6).map(Number);
  if (values.length !== 6 || values.some((value) => !Number.isFinite(value))) return null;

  return values;
}

function readInsta360ImuSnapshot(filePath, makerNoteSample) {
  const fileSize = fs.statSync(filePath).size;
  const trailerLengthOffset = fileSize - 40;
  const trailerStartOffset = fileSize - 78;
  const magicOffset = fileSize - 32;
  let descriptor;

  try {
    if (fileSize < 78 || trailerLengthOffset < 0 || trailerStartOffset < 0) return null;

    descriptor = fs.openSync(filePath, 'r');
    const magic = Buffer.alloc(32);
    fs.readSync(descriptor, magic, 0, magic.length, magicOffset);
    if (magic.toString('ascii') !== '8db42d694ccc418790edff439fe026bf') return null;

    const trailerLengthBuffer = Buffer.alloc(4);
    fs.readSync(descriptor, trailerLengthBuffer, 0, trailerLengthBuffer.length, trailerLengthOffset);
    const trailerLength = trailerLengthBuffer.readUInt32LE(0);
    if (trailerLength < 78 || trailerLength > fileSize) return null;

    for (let offset = -78; offset > -trailerLength;) {
      const recordOffset = fileSize + offset;
      if (recordOffset < 0) return null;

      const header = Buffer.alloc(6);
      fs.readSync(descriptor, header, 0, header.length, recordOffset);
      const segmentId = header.readUInt16LE(0);
      const segmentLength = header.readUInt32LE(2);
      if (!segmentLength || segmentLength > fileSize + offset) return null;

      if (segmentId === 0x0300 && segmentLength % 56 === 0) {
        const segment = Buffer.alloc(segmentLength);
        fs.readSync(descriptor, segment, 0, segment.length, recordOffset - segmentLength);
        return findClosestImuSample(segment, makerNoteSample);
      }

      offset -= segmentLength + 6;
    }
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }

  return null;
}

function findClosestImuSample(segment, makerNoteSample) {
  let closestSample;
  let closestDistance = Infinity;

  for (let offset = 0; offset < segment.length; offset += 56) {
    const sample = [
      segment.readDoubleLE(offset + 8),
      segment.readDoubleLE(offset + 16),
      segment.readDoubleLE(offset + 24),
      segment.readDoubleLE(offset + 32),
      segment.readDoubleLE(offset + 40),
      segment.readDoubleLE(offset + 48),
    ];
    const distance = sample.reduce((total, value, index) => total + (value - makerNoteSample[index]) ** 2, 0);
    if (distance < closestDistance) {
      closestDistance = distance;
      closestSample = sample;
    }
  }

  return closestDistance < 0.001 ? closestSample : null;
}

function imuSnapshotToV360Orientation([accelerationX, accelerationY, accelerationZ]) {
  const radiansToDegrees = 180 / Math.PI;
  const magnitude = Math.hypot(accelerationX, accelerationY, accelerationZ);
  if (!Number.isFinite(magnitude) || magnitude < 0.9 || magnitude > 1.1) {
    return { yaw: 0, pitch: 0, roll: 180 };
  }

  const x = accelerationX / magnitude;
  const y = -accelerationZ / magnitude;
  const z = accelerationY / magnitude;
  const roll = Math.atan2(x, y) * radiansToDegrees;
  const pitch = -Math.atan2(z, Math.hypot(x, y)) * radiansToDegrees;

  return {
    yaw: 0,
    pitch: Number(pitch.toFixed(3)),
    roll: Number(roll.toFixed(3)),
  };
}

function createImageThumbnail(filePath, thumpPath) {
  return new Promise((resolve, reject) => {
    gm(filePath)
      .resize(450)
      .autoOrient()
      .write(thumpPath, (error) => {
        if (error) {
          removeFileIfPresent(thumpPath);
          reject(error);
          return;
        }
        if (!isUsableFile(thumpPath)) {
          reject(new Error('Unable to create the Insta360 photo thumbnail.'));
          return;
        }
        resolve();
      });
  });
}

function isUsableFile(filePath) {
  try {
    const stats = fs.statSync(filePath);
    return stats.isFile() && stats.size > 0;
  } catch (error) {
    return false;
  }
}

function isJpegFile(filePath) {
  let descriptor;
  try {
    descriptor = fs.openSync(filePath, 'r');
    const header = Buffer.alloc(3);
    const bytesRead = fs.readSync(descriptor, header, 0, header.length, 0);
    return bytesRead === 3 && header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff;
  } catch (error) {
    return false;
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function hasExpectedImageFormat(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  if (['.jpg', '.jpeg'].includes(extension)) return isJpegFile(filePath);
  if (extension !== '.png') return false;

  let descriptor;
  try {
    descriptor = fs.openSync(filePath, 'r');
    const header = Buffer.alloc(8);
    const bytesRead = fs.readSync(descriptor, header, 0, header.length, 0);
    return bytesRead === 8 && header.equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  } catch (error) {
    return false;
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function removeFileIfPresent(filePath) {
  try {
    fs.unlinkSync(filePath);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
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

function getInsta360ImageName(origPath) {
  const stats = fs.statSync(origPath);
  const parsed = path.parse(origPath);
  return `${parsed.name}-${stats.size}-${getPathHash(origPath)}-insta360-v6.jpg`;
}

function getPathHash(origPath) {
  return crypto.createHash('sha256').update(origPath).digest('hex').slice(0, 12);
}

module.exports = { Media, formatImageMetadata, formatVideoMetadata };
Object.defineProperty(module.exports, 'default', {
  value: Media,
  enumerable: false,
});
