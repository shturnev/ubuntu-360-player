const { createTools } = jest.requireActual('../../src/models/mediaTools');

// Pins the Linux command layout so specs asserting on 'ffmpeg'/'perl' pass on any host OS.
module.exports = createTools({
  platform: 'linux',
  env: {},
  loadModule: () => '/opt/exiftool-vendored.pl/bin/exiftool',
});
