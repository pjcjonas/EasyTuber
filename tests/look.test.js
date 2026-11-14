/* Eyes / head follow the mouse: the pointer position the desktop app sends, the server route that
   switches the watching on and off, and what the animator does with it. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const vm = require('node:vm');
const look = require('../electron/look');
const { start } = require('../electron/server');

const ROOT = path.join(__dirname, '..');
function loadPT() {
  const ctx = { window: {}, navigator: { platform: 'Win32' }, structuredClone, console };
  ctx.window = ctx;
  vm.createContext(ctx);
  for (const f of ['util.js', 'defs.js', 'animator.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8'), ctx, { filename: f });
  return ctx.PT;
}

test('the pointer position is given from -1 to 1 across its own screen', () => {
  const screen = { x: 0, y: 0, width: 1920, height: 1080 };
  assert.deepEqual(look.normalise({ x: 960, y: 540 }, screen), { x: 0, y: 0 });
  assert.deepEqual(look.normalise({ x: 0, y: 0 }, screen), { x: -1, y: -1 });
  assert.deepEqual(look.normalise({ x: 1920, y: 1080 }, screen), { x: 1, y: 1 });
  assert.deepEqual(look.normalise({ x: 1440, y: 270 }, screen), { x: 0.5, y: -0.5 });
  // a second screen to the left of the first
  assert.deepEqual(look.normalise({ x: -960, y: 540 }, { x: -1920, y: 0, width: 1920, height: 1080 }), { x: 0, y: 0 });
  // outside the screen, or nothing to go by: held in, never NaN
  assert.deepEqual(look.normalise({ x: 5000, y: -900 }, screen), { x: 1, y: -1 });
  assert.deepEqual(look.normalise(null, screen), { x: 0, y: 0 });
  assert.deepEqual(look.normalise({ x: 1, y: 1 }, { x: 0, y: 0, width: 0, height: 0 }), { x: 0, y: 0 });
});

test('the watcher only speaks when the pointer has moved, and looks ahead when stopped', () => {
  const bounds = { x: 0, y: 0, width: 1000, height: 1000 };
  let point = { x: 500, y: 500 };
  const sent = [];
  const w = look.watcher(() => ({ point, bounds }), (pos) => sent.push(pos), 100000);
  assert.equal(w.on, false);
  assert.deepEqual(w.set(true), { on: true });
  assert.deepEqual(sent, [{ x: 0, y: 0 }]);                           // where it is, straight away
  w.tick(); w.tick();
  assert.equal(sent.length, 1);                                       // not moved: nothing sent
  point = { x: 750, y: 250 };
  w.tick(); w.tick();
  assert.deepEqual(sent[1], { x: 0.5, y: -0.5 });
  assert.equal(sent.length, 2);
  point = { x: 751, y: 250 };                                         // a pixel: not worth a message
  w.tick();
  assert.equal(sent.length, 2);
  assert.deepEqual(w.set(true), { on: true });                        // already on
  assert.deepEqual(w.set(false), { on: false });
  assert.deepEqual(sent[2], { x: 0, y: 0 });                          // back to the middle
  assert.deepEqual(w.set(false), { on: false });
  assert.equal(sent.length, 3);
  // a read that fails is skipped
  const bad = look.watcher(() => { throw new Error('no screen'); }, (pos) => sent.push(pos), 100000);
  bad.set(true); bad.tick(); bad.set(false);
  assert.equal(sent.length, 3);
});

test('/api/look switches the watching on and off, JSON only', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'easytuber-test-'));
  const calls = [];
  const srv = await start({ root: ROOT, saveFile: path.join(dir, 'avatar.json'), port: 18950, onLook: (on) => { calls.push(on); return { on }; } });
  const bare = await start({ root: ROOT, saveFile: path.join(dir, 'other.json'), port: 18951 });
  t.after(() => { srv.close(); bare.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  const post = (port, body, headers = { 'Content-Type': 'application/json' }) => new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method: 'POST', path: '/api/look', headers }, (res) => { let d = ''; res.on('data', (c) => d += c); res.on('end', () => resolve({ status: res.statusCode, body: d })); });
    req.on('error', reject); req.end(body);
  });
  assert.deepEqual(await post(srv.port, '{"on":true}'), { status: 200, body: '{"on":true}' });
  assert.deepEqual(await post(srv.port, '{"on":false}'), { status: 200, body: '{"on":false}' });
  assert.deepEqual(calls, [true, false]);
  assert.equal((await post(srv.port, '{"on":"yes"}')).status, 400);
  assert.equal((await post(srv.port, 'on=true', { 'Content-Type': 'text/plain' })).status, 415);   // what a web page could send
  assert.equal((await post(srv.port, '{"on":true}', { 'Content-Type': 'application/json', Host: 'evil.example' })).status, 403);
  assert.equal(calls.length, 2);
  assert.equal((await post(bare.port, '{"on":true}')).status, 501);  // not the desktop app
});

test('the eyes and head go towards the pointer, as far as their sliders say', () => {
  const PT = loadPT();
  const base = PT.defaultProject();
  assert.equal(base.motion.eyesFollow, 0);
  assert.equal(base.motion.headFollow, 0);
  const still = { ...base.motion, idleSway: 0, breathAmount: 0, armSway: 0, headTilt: 0, headBob: 0, bodyBounce: 0, gesture: 0 };
  const settle = (motion, where) => { const a = new PT.Animator(); let d; for (let i = 0; i < 240; i++) d = a.update(1 / 60, 0, motion, base.mic, where).deltas; return d; };
  const right = { x: 1, y: 0.5 };

  // off: nothing moves, wherever the pointer is
  let d = settle(still, right);
  assert.equal(d.eyes.ox, 0); assert.equal(d.eyes.oy, 0);
  assert.ok(Math.abs(d.face.rot) < 1e-6 && Math.abs(d.face.ox) < 1e-6);

  // eyes only
  d = settle({ ...still, eyesFollow: 1 }, right);
  assert.ok(Math.abs(d.eyes.ox - 7) < 0.05, 'eyes right: ' + d.eyes.ox);
  assert.ok(Math.abs(d.eyes.oy - 2) < 0.05, 'eyes down: ' + d.eyes.oy);
  assert.ok(Math.abs(d.face.rot) < 1e-6);
  assert.ok(Math.abs(settle({ ...still, eyesFollow: 2 }, right).eyes.ox - 14) < 0.1);   // twice as far
  assert.ok(settle({ ...still, eyesFollow: 1 }, { x: -1, y: 0 }).eyes.ox < -6.9);       // and to the left

  // head only
  d = settle({ ...still, headFollow: 1 }, right);
  assert.equal(d.eyes.ox, 0);
  assert.ok(Math.abs(d.face.rot - 5) < 0.05, 'head turns: ' + d.face.rot);
  assert.ok(Math.abs(d.face.ox - 6) < 0.05 && Math.abs(d.face.oy - 2) < 0.05);

  // it eases there rather than jumping, and comes back when the pointer does
  const a = new PT.Animator();
  const first = a.update(1 / 60, 0, { ...still, eyesFollow: 1 }, base.mic, right).deltas.eyes.ox;
  assert.ok(first > 0 && first < 2, 'eased: ' + first);
  let back;
  for (let i = 0; i < 240; i++) back = a.update(1 / 60, 0, { ...still, eyesFollow: 1 }, base.mic, null).deltas.eyes.ox;
  assert.ok(Math.abs(back) < 0.05);
  // odd input never breaks the pose
  d = settle({ ...still, eyesFollow: 1, headFollow: 1 }, { x: 'far', y: 99 });
  assert.ok([d.eyes.ox, d.eyes.oy, d.face.rot].every(Number.isFinite));
  assert.ok(Math.abs(d.eyes.oy - 4) < 0.05);                           // held to the edge of the screen
});
