const fs = require('fs');
const os = require('os');
const path = require('path');
const { resolveLaunchPath } = require('../../src/models/launchPaths');
const renameNoReplace = require('../../src/models/renameNoReplace');

describe('resolveLaunchPath', () => {
  const win = { platform: 'win32', workingDirectory: 'D:\\Work' };

  it.each([
    ['C:\\Photos\\a.jpg', 'C:\\Photos\\a.jpg'],
    ['C:/Photos/a b.jpg', 'C:\\Photos\\a b.jpg'],
    ['"C:\\My Photos\\ф.jpg"', 'C:\\My Photos\\ф.jpg'],
    ['\\\\server\\share\\a.mp4', '\\\\server\\share\\a.mp4'],
    ['file:///C:/My%20Photos/%D1%84.jpg', 'C:\\My Photos\\ф.jpg'],
    ['file://server/share/a.png', '\\\\server\\share\\a.png'],
    ['rel\\a.jpg', 'D:\\Work\\rel\\a.jpg'],
  ])('resolves Windows argument %s', (input, expected) => {
    expect(resolveLaunchPath(input, win)).toBe(expected);
  });

  it.each(['http://x/a.jpg', 'javascript:alert(1)', 'ms-settings:foo', '--flag', '', '   ', 5])(
    'rejects %p',
    (input) => {
      expect(resolveLaunchPath(input, win)).toBeNull();
    }
  );

  it('keeps POSIX semantics on Linux', () => {
    expect(resolveLaunchPath('a b.jpg', { platform: 'linux', workingDirectory: '/home/u' })).toBe('/home/u/a b.jpg');
    expect(resolveLaunchPath('file:///home/u/a%20b.jpg', { platform: 'linux' })).toBe('/home/u/a b.jpg');
    expect(resolveLaunchPath('C:\\x.jpg', { platform: 'linux', workingDirectory: '/h' })).toBeNull();
  });
});

describe('renameNoReplace', () => {
  let dir;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rnr-'));
  });
  afterEach(() => {
    jest.restoreAllMocks();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('moves the file when the target is free', async () => {
    const source = path.join(dir, 's');
    const target = path.join(dir, 't');
    fs.writeFileSync(source, 'data');
    await renameNoReplace(source, target);
    expect(fs.readFileSync(target, 'utf8')).toBe('data');
    expect(fs.existsSync(source)).toBe(false);
  });

  it('fails with EEXIST and keeps both files', async () => {
    const source = path.join(dir, 's');
    const target = path.join(dir, 't');
    fs.writeFileSync(source, 'new');
    fs.writeFileSync(target, 'old');
    await expect(renameNoReplace(source, target)).rejects.toMatchObject({ code: 'EEXIST' });
    expect(fs.readFileSync(target, 'utf8')).toBe('old');
    expect(fs.existsSync(source)).toBe(true);
  });

  it('falls back to an exclusive copy when hard links are not permitted', async () => {
    const source = path.join(dir, 's');
    const target = path.join(dir, 't');
    fs.writeFileSync(source, 'data');
    jest.spyOn(fs.promises, 'link').mockRejectedValue(Object.assign(new Error('no'), { code: 'EPERM' }));
    await renameNoReplace(source, target);
    expect(fs.readFileSync(target, 'utf8')).toBe('data');
    expect(fs.existsSync(source)).toBe(false);
  });

  it('does not overwrite in the copy fallback', async () => {
    const source = path.join(dir, 's');
    const target = path.join(dir, 't');
    fs.writeFileSync(source, 'new');
    fs.writeFileSync(target, 'old');
    jest.spyOn(fs.promises, 'link').mockRejectedValue(Object.assign(new Error('no'), { code: 'EPERM' }));
    await expect(renameNoReplace(source, target)).rejects.toMatchObject({ code: 'EEXIST' });
    expect(fs.readFileSync(target, 'utf8')).toBe('old');
  });
});
