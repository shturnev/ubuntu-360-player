const fs = require('fs');

const unpackAsar = (file) => file.replace(/\.asar([/\\])/, '.asar.unpacked$1');

/**
 * Resolves external media tools.
 * Linux/macOS use system ffmpeg/ffprobe and ExifTool through Perl (as before).
 * Windows uses binaries bundled in the package (nothing is expected in PATH).
 * SHT_VR_TOOLS=system forces PATH lookup on any platform.
 */
function createTools({ platform = process.platform, env = process.env, loadModule = require } = {}) {
  const bundled = platform === 'win32' && env.SHT_VR_TOOLS !== 'system';

  function bundledPath(name, packageName, pick) {
    let resolved;
    try {
      resolved = pick(loadModule(packageName));
    } catch (error) {
      throw toolMissingError(name, `package ${packageName} is not installed`, error);
    }
    const file = unpackAsar(resolved);
    if (!fs.existsSync(file)) throw toolMissingError(name, `${file} does not exist`);
    return file;
  }

  function toolMissingError(name, reason, cause) {
    const error = new Error(`${name} is not available: ${reason}.`);
    error.code = 'TOOL_MISSING';
    error.tool = name;
    if (cause) error.cause = cause;
    return error;
  }

  return {
    bundled,
    ffmpeg: () => (bundled ? bundledPath('ffmpeg', 'ffmpeg-static', (value) => value) : 'ffmpeg'),
    ffprobe: () => (bundled ? bundledPath('ffprobe', 'ffprobe-static', (value) => value.path) : 'ffprobe'),
    /** Returns { command, args } that run ExifTool with the given arguments. */
    exiftool(args) {
      if (bundled) {
        return {
          command: bundledPath('exiftool', 'exiftool-vendored.exe', (value) => value),
          args,
        };
      }
      return {
        command: 'perl',
        args: [unpackAsar(loadModule('exiftool-vendored.pl')), ...args],
      };
    },
    missingToolMessage(tool) {
      return bundled
        ? `The bundled ${tool} is missing. Reinstall 360 Media Viewer.`
        : tool === 'exiftool'
          ? 'Perl is not installed or not available in PATH.'
          : `${tool} is not installed or not available in PATH.`;
    },
  };
}

module.exports = { ...createTools(), createTools, unpackAsar };
