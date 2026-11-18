const { exportFileName } = require('../../src/models/exportName');

describe('exportFileName', () => {
  test('keeps names unchanged outside Windows', () => {
    expect(exportFileName('/a/CON:x.jpg', '.jpg', 'linux')).toBe('CON:x.jpg');
  });

  test.each([
    ['C:\\a\\CON.jpg', '_CON.jpg'],
    ['C:\\a\\nul.jpg', '_nul.jpg'],
    ['C:\\a\\COM1.jpg', '_COM1.jpg'],
    ['C:\\a\\a:b?c.jpg', 'a_b_c.jpg'],
    ['C:\\a\\name. .jpg', 'name.jpg'],
  ])('sanitizes %s on Windows', (input, expected) => {
    expect(exportFileName(input, '.jpg', 'win32')).toBe(expected);
  });

  test('truncates very long names on Windows', () => {
    const name = exportFileName(`C:\\a\\${'x'.repeat(400)}.jpg`, '.jpg', 'win32');
    expect(name).toBe(`${'x'.repeat(200)}.jpg`);
  });

  test('falls back when the name is empty after cleanup', () => {
    expect(exportFileName('C:\\a\\...jpg', '.jpg', 'win32')).toBe('media.jpg');
  });
});
