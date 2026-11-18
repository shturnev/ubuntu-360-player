const path = require('path');
const { fileURLToPath } = require('url');

// Two or more characters before ':' is a URL scheme. A single letter is a drive on Windows only.
const URL_SCHEME = /^[a-zA-Z][a-zA-Z\d+.-]+:/;
const POSIX_URL_SCHEME = /^[a-zA-Z][a-zA-Z\d+.-]*:/;

function stripQuotes(argument) {
  return argument.length >= 2 && argument.startsWith('"') && argument.endsWith('"') ? argument.slice(1, -1) : argument;
}

/**
 * Converts one launch argument to an absolute filesystem path.
 * Returns null for flags, empty values and foreign URL schemes.
 */
function resolveLaunchPath(rawArgument, { workingDirectory, platform = process.platform } = {}) {
  if (typeof rawArgument !== 'string') return null;
  const argument = stripQuotes(rawArgument.trim());
  if (!argument || argument.startsWith('-')) return null;

  const windows = platform === 'win32';
  const pathApi = windows ? path.win32 : path.posix;

  if (/^file:/i.test(argument)) {
    return fileURLToPath(argument, { windows });
  }
  if ((windows ? URL_SCHEME : POSIX_URL_SCHEME).test(argument)) return null;

  return pathApi.resolve(workingDirectory || process.cwd(), argument);
}

module.exports = { resolveLaunchPath };
