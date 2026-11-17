const path = require('path');
const extensions = ['jpg', 'jpeg', 'png', 'insp', 'mp4', 'insv'];

function isSupportedMediaPath(filePath) {
  return typeof filePath === 'string' && extensions.includes(path.extname(filePath).slice(1).toLowerCase());
}

function groupInsvFiles(files) {
  const groups = new Map();
  const work = [];
  for (const filePath of files) {
    if (typeof filePath !== 'string' || path.extname(filePath).toLowerCase() !== '.insv') {
      work.push({ filePath });
      continue;
    }

    const match = /^VID_(\d{8})_(\d{6})_(00|10)_(\d+)\.insv$/i.exec(path.basename(filePath));
    if (!match) {
      work.push({ filePath, error: 'Unsupported INSV filename; the lens pair cannot be identified.' });
      continue;
    }
    const key = JSON.stringify([path.resolve(path.dirname(filePath)), match[1], match[2], match[4]]);
    if (!groups.has(key)) {
      const group = { filePath, lenses: { '00': [], 10: [] } };
      groups.set(key, group);
      work.push(group);
    }
    groups.get(key).lenses[match[3]].push(filePath);
  }
  return work.map((item) => {
    if (!item.lenses) return item;
    const first = item.lenses['00'];
    const second = item.lenses['10'];
    if (first.length > 1 || second.length > 1) {
      return { filePath: item.filePath, error: 'Ambiguous INSV pair: multiple files for the same lens.' };
    }
    if (!first.length || !second.length) {
      return { filePath: item.filePath, error: 'Incomplete INSV pair: both 00 and 10 lens files are required.' };
    }
    return { filePath: first[0], insvPair: [first[0], second[0]] };
  });
}

module.exports = { extensions, isSupportedMediaPath, groupInsvFiles };
