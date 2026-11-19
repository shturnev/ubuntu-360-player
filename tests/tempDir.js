const fs = require('fs');
const os = require('os');

module.exports = () => fs.realpathSync(os.tmpdir());
