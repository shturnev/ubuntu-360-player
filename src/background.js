const { app } = require('electron');

if (require.main === module) {
  require('../electron/main');
}

module.exports = { app };
