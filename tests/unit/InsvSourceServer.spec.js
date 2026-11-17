const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const express = require('express');
const { InsvSourceServer } = require('../../src/models/insvSourceServer');

describe('INSV source server', () => {
  let directory;
  let files;
  let sources;
  let server;
  let token;

  const request = (url, headers = {}, method = 'GET') =>
    new Promise((resolve, reject) => {
      const req = http.request(
        { hostname: '127.0.0.1', port: server.address().port, path: url, headers, method },
        (res) => {
          const chunks = [];
          res.on('data', (chunk) => chunks.push(chunk));
          res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
          res.on('error', reject);
        }
      );
      req.on('error', reject);
      req.end();
    });

  beforeEach(async () => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'insv-server-'));
    files = [path.join(directory, '00.insv'), path.join(directory, '10.insv')];
    fs.writeFileSync(files[0], 'first-lens');
    fs.writeFileSync(files[1], 'second-lens');
    const snapshots = files.map((file) => {
      const stat = fs.statSync(file);
      return { dev: stat.dev, ino: stat.ino, size: stat.size, mtimeMs: stat.mtimeMs, ctimeMs: stat.ctimeMs };
    });
    sources = new InsvSourceServer();
    token = sources.register({ paths: files, snapshots });
    const app = express();
    app.get('/insv/:token/orientation', (req, res) => void sources.serveHorizon(req, res));
    app.get('/insv/:token/gyro-orientation', (req, res) => void sources.serveHorizon(req, res, true));
    app.get('/insv/:token/:lens', (req, res) => void sources.serve(req, res));
    await new Promise((resolve) => {
      server = app.listen(0, '127.0.0.1', resolve);
    });
  });

  afterEach(async () => {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(directory, { recursive: true, force: true });
  });

  test('serves only authorized lenses with MP4 MIME and byte ranges', async () => {
    const url = `/insv/${token}/0`;
    const result = await request(url, { Range: 'bytes=2-5' });
    expect(result.status).toBe(206);
    expect(result.headers['content-type']).toBe('video/mp4');
    expect(result.headers['content-range']).toBe('bytes 2-5/10');
    expect(result.body.toString()).toBe('rst-');
    expect((await request(url, { Range: 'bytes=-4' })).body.toString()).toBe('lens');
    expect((await request(url, { Range: 'bytes=999-' })).status).toBe(416);
    expect((await request(`/insv/${token}/2`)).status).toBe(404);
    expect((await request('/insv/not-authorized/0')).status).toBe(404);
    const head = await request(url, {}, 'HEAD');
    expect(head.status).toBe(200);
    expect(head.headers['content-length']).toBe('10');
    expect(head.body).toHaveLength(0);
  });

  test('invalidates both lenses when either original changes', async () => {
    fs.appendFileSync(files[1], 'changed');
    expect((await request(`/insv/${token}/0`)).status).toBe(410);
    expect((await request(`/insv/${token}/1`)).status).toBe(404);
  });

  test('rejects a replaced source and honors revocation', async () => {
    fs.unlinkSync(files[1]);
    fs.symlinkSync(files[0], files[1]);
    expect((await request(`/insv/${token}/0`)).status).toBe(410);
    sources.revoke(token);
    expect((await request(`/insv/${token}/0`)).status).toBe(404);
  });

  test('closes both source handles if the client disconnects during validation', async () => {
    const open = fs.promises.open.bind(fs.promises);
    const handles = [];
    const response = { destroyed: false };
    const spy = jest.spyOn(fs.promises, 'open').mockImplementation(async (...args) => {
      const handle = await open(...args);
      jest.spyOn(handle, 'close');
      handles.push(handle);
      response.destroyed = true;
      return handle;
    });

    try {
      await sources.serve({ params: { token, lens: '0' }, headers: {}, method: 'GET' }, response);
      expect(handles).toHaveLength(2);
      expect(handles.every((handle) => handle.close.mock.calls.length === 1)).toBe(true);
      expect(sources.records.has(token)).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });

  test('authorizes and caches horizon data for the current pair only', async () => {
    const track = [{ time: 0, rotation: [0, 0, 0, 1] }];
    sources.createHorizonTrack = jest.fn().mockResolvedValue(track);
    const url = `/insv/${token}/orientation`;
    const response = await request(url);
    expect(response.status).toBe(200);
    expect(JSON.parse(response.body)).toEqual(track);
    await request(url);
    expect(sources.createHorizonTrack).toHaveBeenCalledTimes(1);
    sources.revoke(token);
    expect((await request(url)).status).toBe(404);
    expect(sources.horizonTracks.size).toBe(0);
  });

  test.each([
    ['orientation', 'createHorizonTrack'],
    ['gyro-orientation', 'createGyroTrack'],
  ])('does not send %s data if either source changes while calculating', async (route, factory) => {
    let start;
    let finish;
    const started = new Promise((resolve) => {
      start = resolve;
    });

    sources[factory] = jest.fn(
      () =>
        new Promise((resolve) => {
          finish = resolve;
          start();
        })
    );
    const pending = request(`/insv/${token}/${route}`);
    await started;
    fs.appendFileSync(files[1], 'changed');
    finish([{ time: 0, rotation: [0, 0, 0, 1] }]);
    expect((await pending).status).toBe(410);
    expect(sources.records.has(token)).toBe(false);
  });

  test('caches gyro and horizon tracks independently and revokes both', async () => {
    sources.createHorizonTrack = jest.fn().mockResolvedValue([{ time: 0, rotation: [0, 0, 0, 1] }]);
    sources.createGyroTrack = jest.fn().mockResolvedValue([{ time: 0, rotation: [0, 1, 0, 0] }]);
    const url = `/insv/${token}/gyro-orientation`;
    expect(JSON.parse((await request(url)).body)[0].rotation).toEqual([0, 1, 0, 0]);
    await request(url);
    await request(`/insv/${token}/orientation`);
    expect(sources.createGyroTrack).toHaveBeenCalledTimes(1);
    expect(sources.createHorizonTrack).toHaveBeenCalledTimes(1);
    sources.revoke(token);
    expect((await request(url)).status).toBe(404);
    expect(sources.gyroTracks.size).toBe(0);
  });
});
