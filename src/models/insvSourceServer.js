const crypto = require('crypto');
const fs = require('fs');
const { assertCurrentPair, matchesSnapshot } = require('./insvPair');
const { openFileNoFollow } = require('./safeOpen');
const { isSamePath } = require('./pathCompare');

function parseRange(value, size) {
  if (!value) return { start: 0, end: size - 1, partial: false };
  const match = /^bytes=(\d*)-(\d*)$/.exec(value);
  if (!match || (!match[1] && !match[2])) return null;
  const first = match[1] ? Number(match[1]) : null;
  const last = match[2] ? Number(match[2]) : null;
  if ((first !== null && !Number.isSafeInteger(first)) || (last !== null && !Number.isSafeInteger(last))) return null;
  if (first === null) {
    if (!last || !size) return null;
    return { start: Math.max(0, size - last), end: size - 1, partial: true };
  }
  if (first >= size || (last !== null && last < first)) return null;
  return { start: first, end: last === null ? size - 1 : Math.min(last, size - 1), partial: true };
}

class InsvSourceServer {
  constructor() {
    this.records = new Map();
    this.horizonTracks = new Map();
  }

  register(pair, frames = []) {
    if (
      !Array.isArray(pair?.paths) ||
      pair.paths.length !== 2 ||
      !Array.isArray(pair.snapshots) ||
      pair.snapshots.length !== 2 ||
      !Array.isArray(frames)
    ) {
      throw new Error('Invalid authorized INSV pair.');
    }
    const token = crypto.randomBytes(24).toString('hex');
    this.records.set(token, pair);
    this.horizonTracks.set(token, frames);
    return token;
  }

  revoke(token) {
    this.records.delete(token);
    this.horizonTracks.delete(token);
  }

  clear() {
    this.records.clear();
    this.horizonTracks.clear();
  }

  async serveHorizon(req, res) {
    const token = req.params.token;
    const pair = this.records.get(token);
    if (!pair) {
      res.sendStatus(404);
      return;
    }
    try {
      await assertCurrentPair(pair);
      if (this.records.get(token) !== pair) {
        res.sendStatus(404);
        return;
      }
    } catch (error) {
      this.revoke(token);
      res.status(410).send('The INSV pair is no longer available or has changed.');
      return;
    }

    res.set('Cache-Control', 'no-store').json(this.horizonTracks.get(token));
  }

  async serve(req, res) {
    const token = req.params.token;
    const pair = this.records.get(token);
    if (!pair || !['0', '1'].includes(req.params.lens)) {
      res.sendStatus(404);
      return;
    }

    const handles = [];
    let streaming = false;
    try {
      for (let index = 0; index < 2; index += 1) {
        const file = pair.paths[index];
        if (!isSamePath(await fs.promises.realpath(file), file)) throw new Error('Source changed.');
        const handle = await openFileNoFollow(file);
        handles.push(handle);
        if (!matchesSnapshot(await handle.stat(), pair.snapshots[index])) throw new Error('Source changed.');
      }
      if (this.records.get(token) !== pair) throw new Error('Authorization changed.');
      if (req.aborted || res.destroyed) return;

      const index = Number(req.params.lens);
      const size = pair.snapshots[index].size;
      const range = parseRange(req.headers.range, size);
      if (!range) {
        res.set('Content-Range', `bytes */${size}`).sendStatus(416);
        return;
      }
      res.set({
        'Content-Type': 'video/mp4',
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'no-store',
        'Content-Length': String(size ? range.end - range.start + 1 : 0),
      });
      if (range.partial) res.set('Content-Range', `bytes ${range.start}-${range.end}/${size}`);
      res.status(range.partial ? 206 : 200);
      if (req.method === 'HEAD' || !size) {
        res.end();
        return;
      }

      const stream = handles[index].createReadStream({ start: range.start, end: range.end, autoClose: false });
      streaming = true;
      let handlesClosed = false;
      const closeHandles = async () => {
        if (handlesClosed) return;
        handlesClosed = true;
        for (const handle of handles) {
          try {
            await handle.close();
          } catch (error) {
            console.error('Unable to close INSV source:', error.message);
          }
        }
      };
      stream.once('error', (error) => res.destroy(error));
      stream.once('end', () => void closeHandles());
      stream.once('close', () => void closeHandles());
      res.once('close', () => stream.destroy());
      stream.pipe(res);
    } catch (error) {
      this.revoke(token);
      if (!res.headersSent) res.status(410).send('The INSV pair is no longer available or has changed.');
      else res.destroy(error);
    } finally {
      if (!streaming) {
        for (const handle of handles) {
          try {
            await handle.close();
          } catch (error) {
            console.error('Unable to close INSV source:', error.message);
          }
        }
      }
    }
  }
}

module.exports = { InsvSourceServer };
