const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { start } = require('../electron/server');
const vcam = require('../electron/vcam');

const ROOT = path.join(__dirname, '..');

// a w x h BGRA picture in one colour
function solid(w, h, [r, g, b]) {
  const buf = Buffer.alloc(w * h * 4);
  for (let i = 0; i < buf.length; i += 4) { buf[i] = b; buf[i + 1] = g; buf[i + 2] = r; buf[i + 3] = 255; }
  return buf;
}

test('the shared-memory queue matches the layout OBS reads', () => {
  const w = 1280, h = 720;
  const { frameSize, offsets, size } = vcam.queueLayout(w, h);
  assert.equal(frameSize, w * h * 3 / 2);
  assert.equal(offsets[0], 96);                       // the 80-byte header, rounded up to 32
  for (const o of offsets) assert.equal(o % 32, 0);
  for (let i = 1; i < 3; i++) assert.ok(offsets[i] - offsets[i - 1] >= frameSize + vcam.FRAME_HEADER);
  assert.ok(size >= offsets[2] + frameSize + vcam.FRAME_HEADER);

  const head = vcam.queueHeader(w, h, 30);
  assert.equal(head.length, 80);
  assert.equal(head.readUInt32LE(vcam.Q.STATE), vcam.Q_STATE.STARTING);
  assert.deepEqual([0, 1, 2].map((i) => head.readUInt32LE(vcam.Q.OFFSETS + i * 4)), offsets);
  assert.equal(head.readUInt32LE(vcam.Q.CX), w);
  assert.equal(head.readUInt32LE(vcam.Q.CY), h);
  assert.equal(head.readBigUInt64LE(vcam.Q.INTERVAL), 333333n);   // 1/30 s in 100 ns units
});

test('BGRA to NV12: black, white and primary colours (BT.709, limited range)', () => {
  const w = 4, h = 2;
  const cases = [
    [[0, 0, 0], [16, 128, 128]],
    [[255, 255, 255], [235, 128, 128]],
    [[255, 0, 0], [63, 102, 240]],
    [[0, 0, 255], [32, 240, 118]],
  ];
  for (const [rgb, [Y, Cb, Cr]] of cases) {
    const out = vcam.bgraToNv12(solid(w, h, rgb), w, h, Buffer.alloc(w * h * 3 / 2));
    for (let i = 0; i < w * h; i++) assert.ok(Math.abs(out[i] - Y) <= 1, `Y of ${rgb}: ${out[i]}`);
    for (let i = w * h; i < out.length; i += 2) {
      assert.ok(Math.abs(out[i] - Cb) <= 1, `Cb of ${rgb}: ${out[i]}`);
      assert.ok(Math.abs(out[i + 1] - Cr) <= 1, `Cr of ${rgb}: ${out[i + 1]}`);
    }
  }
});

test('BGRA to NV12 keeps rows and columns where they are', () => {
  const w = 4, h = 4, src = solid(w, h, [0, 0, 0]);
  const at = (x, y) => (y * w + x) * 4;
  src.fill(255, at(3, 0), at(3, 0) + 3);              // one white pixel, top right
  const out = vcam.bgraToNv12(src, w, h, Buffer.alloc(w * h * 3 / 2));
  assert.equal(out[3], 235);
  assert.equal(out.subarray(0, 16).filter((v) => v !== 16).length, 1);
});

test('BGRA to UYVY: byte order and row padding', () => {
  const w = 4, h = 2, stride = 12;                    // 8 bytes of picture + 4 of padding per row
  const out = vcam.bgraToUyvy(solid(w, h, [255, 0, 0]), w, h, Buffer.alloc(stride * h, 0xEE), stride);
  for (let y = 0; y < h; y++) {
    const row = out.subarray(y * stride, y * stride + stride);
    for (let x = 0; x < 8; x += 4) {
      assert.ok(Math.abs(row[x] - 102) <= 1 && Math.abs(row[x + 2] - 240) <= 1, 'Cb then Cr');
      assert.ok(Math.abs(row[x + 1] - 63) <= 1 && Math.abs(row[x + 3] - 63) <= 1, 'Y after each');
    }
    assert.deepEqual([...row.subarray(8)], [0xEE, 0xEE, 0xEE, 0xEE]);
  }
});

test('open() refuses a system with no camera support', async () => {
  await assert.rejects(vcam.open(1280, 720, 'linux'), (e) => e.code === 'unsupported');
});

function request(port, method, p, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path: p, headers }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

test('/api/vcam asks the app for the status and turns the camera on and off', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'easytuber-test-'));
  const calls = [];
  let on = false;
  const srv = await start({
    root: ROOT, saveFile: path.join(dir, 'avatar.json'), port: 18797,
    onVcam: async (want) => { calls.push(want); if (typeof want === 'boolean') on = want; return { on, device: 'OBS Virtual Camera', error: '' }; },
  });
  t.after(() => { srv.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  const json = { 'Content-Type': 'application/json' };

  assert.equal(JSON.parse((await request(srv.port, 'GET', '/api/vcam')).body).on, false);
  const started = await request(srv.port, 'POST', '/api/vcam', JSON.stringify({ on: true }), json);
  assert.equal(started.status, 200);
  assert.equal(JSON.parse(started.body).on, true);
  assert.equal(JSON.parse((await request(srv.port, 'POST', '/api/vcam', JSON.stringify({ on: false }), json)).body).on, false);
  assert.deepEqual(calls, [undefined, true, false]);

  // another website can't switch the camera on: only JSON is taken, and only a real true / false
  assert.equal((await request(srv.port, 'POST', '/api/vcam', JSON.stringify({ on: true }), { 'Content-Type': 'text/plain' })).status, 415);
  assert.equal((await request(srv.port, 'POST', '/api/vcam', JSON.stringify({ on: 'yes' }), json)).status, 400);
  assert.equal((await request(srv.port, 'POST', '/api/vcam', '{', json)).status, 400);
  assert.equal(calls.length, 3);
});

test('/api/vcam says so when there is no desktop app behind the server', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'easytuber-test-'));
  const srv = await start({ root: ROOT, saveFile: path.join(dir, 'avatar.json'), port: 18807 });
  t.after(() => { srv.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  assert.equal((await request(srv.port, 'GET', '/api/vcam')).status, 501);
});
