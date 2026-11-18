const path = require('path');
const { groupInsvFiles, isSupportedMediaPath } = require('../../src/models/mediaFormats');

describe('INSV grouping', () => {
  const first = '/media/VID_20250125_151712_00_105.insv';
  const second = '/media/VID_20250125_151712_10_105.INSV';

  test('groups confirmed pairs independently of order and extension case', () => {
    expect(isSupportedMediaPath(second)).toBe(true);
    expect(groupInsvFiles([second, first, '/media/photo.jpg'])).toEqual([
      { filePath: first, insvPair: [first, second] },
      { filePath: '/media/photo.jpg' },
    ]);
  });

  test('reports missing and unknown lenses without joining other directories or identifiers', () => {
    const otherDirectory = path.join('/other', path.basename(second));
    const otherId = second.replace('105.INSV', '106.INSV');
    const unknown = '/media/other.insv';
    const result = groupInsvFiles([first, otherDirectory, otherId, unknown]);
    expect(result).toHaveLength(4);
    expect(result.slice(0, 3).every((item) => item.error.includes('Incomplete'))).toBe(true);
    expect(result[3].error).toMatch(/Unsupported INSV filename/);
  });

  test('rejects repeated and case-variant candidates rather than selecting one', () => {
    const result = groupInsvFiles([first, first.replace('.insv', '.INSV'), second]);
    expect(result).toHaveLength(1);
    expect(result[0].error).toMatch(/Ambiguous/);
  });
});
