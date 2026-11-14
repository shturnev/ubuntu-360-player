const { isConvertedVideoName } = require('../../src/mediaUtils');

describe('isConvertedVideoName', () => {
  test('recognizes both legacy and path-hashed converted video cache names', () => {
    expect(isConvertedVideoName('clip-1024-h264.mp4')).toBe(true);
    expect(isConvertedVideoName('clip-1024-a1b2c3d4e5f6-h264.mp4')).toBe(true);
  });

  test('does not classify original video cache names as converted', () => {
    expect(isConvertedVideoName('clip-1024-a1b2c3d4e5f6.mp4')).toBe(false);
  });
});
