const fs = require('fs');
const os = require('os');
const path = require('path');
const { createTools, unpackAsar } = jest.requireActual('../../src/models/mediaTools');
const { isSamePath } = require('../../src/models/pathCompare');

describe('mediaTools', () => {
  let dir;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tools-'));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  const touch = (name) => {
    const file = path.join(dir, name);
    fs.writeFileSync(file, '');
    return file;
  };

  it('uses system tools and Perl ExifTool on Linux', () => {
    const tools = createTools({ platform: 'linux', env: {}, loadModule: () => '/x/exiftool' });
    expect(tools.bundled).toBe(false);
    expect(tools.ffmpeg()).toBe('ffmpeg');
    expect(tools.ffprobe()).toBe('ffprobe');
    expect(tools.exiftool(['-ver'])).toEqual({ command: 'perl', args: ['/x/exiftool', '-ver'] });
  });

  it('uses bundled binaries on Windows without PATH or Perl', () => {
    const ffmpeg = touch('ffmpeg.exe');
    const ffprobe = touch('ffprobe.exe');
    const exiftool = touch('exiftool.exe');
    const modules = { 'ffmpeg-static': ffmpeg, 'ffprobe-static': { path: ffprobe }, 'exiftool-vendored.exe': exiftool };
    const tools = createTools({ platform: 'win32', env: {}, loadModule: (name) => modules[name] });
    expect(tools.bundled).toBe(true);
    expect(tools.ffmpeg()).toBe(ffmpeg);
    expect(tools.ffprobe()).toBe(ffprobe);
    expect(tools.exiftool(['-ver'])).toEqual({ command: exiftool, args: ['-ver'] });
  });

  it('honors SHT_VR_TOOLS=system on Windows', () => {
    const tools = createTools({ platform: 'win32', env: { SHT_VR_TOOLS: 'system' }, loadModule: () => '/x' });
    expect(tools.ffmpeg()).toBe('ffmpeg');
  });

  it('reports a missing bundled tool explicitly', () => {
    const tools = createTools({
      platform: 'win32',
      env: {},
      loadModule: () => path.join(dir, 'absent.exe'),
    });
    expect(() => tools.ffmpeg()).toThrow(/ffmpeg is not available/);
    try {
      tools.ffmpeg();
    } catch (error) {
      expect(error.code).toBe('TOOL_MISSING');
    }
    expect(tools.missingToolMessage('ffmpeg')).toMatch(/Reinstall/);
  });

  it('points packaged binaries at app.asar.unpacked', () => {
    expect(unpackAsar('C:\\app\\resources\\app.asar\\node_modules\\x\\a.exe')).toBe(
      'C:\\app\\resources\\app.asar.unpacked\\node_modules\\x\\a.exe'
    );
  });
});

describe('isSamePath', () => {
  it('ignores case and separator style on Windows only', () => {
    expect(isSamePath('C:\\Photos\\A.jpg', 'c:/photos/a.JPG', 'win32')).toBe(true);
    expect(isSamePath('/home/u/A.jpg', '/home/u/a.jpg', 'linux')).toBe(false);
    expect(isSamePath('/home/u/a.jpg', '/home/u//a.jpg', 'linux')).toBe(true);
  });
});
