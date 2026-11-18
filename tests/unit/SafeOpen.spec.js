const fs = require('fs');
const os = require('os');
const path = require('path');
const { openFileNoFollow } = require('../../src/models/safeOpen');
const mediaCache = require('../../src/models/mediaCache');

describe('openFileNoFollow', () => {
  let dir;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'safeopen-'));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it.each(['linux', 'win32'])('opens a regular file (%s)', async (platform) => {
    const file = path.join(dir, 'a.bin');
    fs.writeFileSync(file, 'data');
    const handle = await openFileNoFollow(file, platform);
    expect((await handle.stat()).size).toBe(4);
    await handle.close();
  });

  it('rejects a symlink on Windows before opening', async () => {
    const file = path.join(dir, 'a.bin');
    const link = path.join(dir, 'link.bin');
    fs.writeFileSync(file, 'data');
    try {
      fs.symlinkSync(file, link);
    } catch (error) {
      if (error.code === 'EPERM') return;
      throw error;
    }
    await expect(openFileNoFollow(link, 'win32')).rejects.toMatchObject({ code: 'ELOOP' });
  });

  it('does not overwrite a concurrently created image cache entry', () => {
    const orig = path.join(dir, 'orig.jpg');
    const target = path.join(dir, 'cache.jpg');
    fs.writeFileSync(orig, 'new');
    fs.writeFileSync(target, 'existing');
    const symlink = jest.spyOn(fs, 'symlinkSync').mockImplementation(() => {
      throw Object.assign(new Error('no'), { code: 'EPERM' });
    });
    try {
      expect(mediaCache.linkOriginal(orig, target, 'image')).toBe('copy');
    } finally {
      symlink.mockRestore();
    }
    expect(fs.readFileSync(target, 'utf8')).toBe('existing');
    expect(fs.readdirSync(dir).filter((name) => name.endsWith('.tmp'))).toEqual([]);
  });
});
