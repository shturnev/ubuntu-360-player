// Skips tests that create symlinks when the OS denies them (Windows without Developer Mode).
const fs = require('fs');
const os = require('os');
const path = require('path');

const canSymlink = (() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'symlink-probe-'));
  try {
    fs.writeFileSync(path.join(dir, 'a'), '');
    fs.symlinkSync(path.join(dir, 'a'), path.join(dir, 'b'));
    return true;
  } catch {
    return false;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
})();

if (!canSymlink) {
  const wrap = (original) => {
    const wrapped = (name, fn, ...rest) => {
      if (typeof fn === 'function' && /symlink/i.test(fn.toString())) {
        return original.skip(name, fn, ...rest);
      }
      return original(name, fn, ...rest);
    };
    wrapped.each =
      (...table) =>
      (name, fn, ...rest) => {
        if (typeof fn === 'function' && /symlink/i.test(fn.toString())) {
          return original.skip.each(...table)(name, fn, ...rest);
        }
        return original.each(...table)(name, fn, ...rest);
      };
    return Object.assign(wrapped, { ...original, each: wrapped.each });
  };
  global.it = wrap(global.it);
  global.test = global.it;
}
