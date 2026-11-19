const fs = require('fs');
const os = require('os');

module.exports = () => fs.realpathSync.native(os.tmpdir());
