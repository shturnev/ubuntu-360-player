const fs = require('fs');
const os = require('os');

if (process.platform === 'win32') {
  process.env.TEMP = fs.realpathSync(os.tmpdir());
}
