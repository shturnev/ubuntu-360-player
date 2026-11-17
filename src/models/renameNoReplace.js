const { execFile } = require('child_process');
const { constants } = require('os');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);

// Node does not expose Linux renameat2(RENAME_NOREPLACE).
const renameScript = `
import ctypes
import os
import sys

libc = ctypes.CDLL(None, use_errno=True)
rename = libc.renameat2
rename.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p, ctypes.c_uint]
rename.restype = ctypes.c_int
if rename(-100, os.fsencode(sys.argv[1]), -100, os.fsencode(sys.argv[2]), 1) != 0:
    error = ctypes.get_errno()
    print(os.strerror(error), file=sys.stderr)
    sys.exit(error if 0 < error < 256 else 1)
`;

async function renameNoReplace(source, target) {
  try {
    await execFileAsync('python3', ['-I', '-c', renameScript, source, target]);
  } catch (error) {
    if (error.code === constants.errno.EEXIST) {
      error.code = 'EEXIST';
      throw error;
    }
    throw new Error(`Unable to publish media without overwriting: ${error.stderr?.trim() || error.message}`);
  }
}

module.exports = renameNoReplace;
