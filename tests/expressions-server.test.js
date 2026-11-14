/* Expressions: expression= in a Streamer.bot address (the server checks it and hands it to the editor). */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { start } = require('../electron/server');

const ROOT = path.join(__dirname, '..');

function request(port, method, p, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path: p, headers }, (res) => {
      let d = ''; res.on('data', (c) => d += c);
      res.on('end', () => { let json = null; try { json = JSON.parse(d); } catch (e) { /* not json */ } resolve({ status: res.statusCode, body: json }); });
    });
    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}
function listen(port) {
  const events = [];
  let req;
  const ready = new Promise((resolve, reject) => {
    req = http.get({ host: '127.0.0.1', port, path: '/api/events' }, (res) => {
      let buf = '';
      res.on('data', (c) => {
        buf += c;
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const block = buf.slice(0, i); buf = buf.slice(i + 2);
          const ev = /^event: (.*)$/m.exec(block), data = /^data: (.*)$/m.exec(block);
          if (!ev) continue;
          if (ev[1] === 'hello') resolve(); else events.push({ event: ev[1], data: JSON.parse(data[1]) });
        }
      });
    });
    req.on('error', reject);
  });
  const waitFor = async (count) => {
    const t0 = Date.now();
    while (events.length < count) {
      if (Date.now() - t0 > 3000) throw new Error(`waited for ${count} events, got ${events.length}`);
      await new Promise((r) => setTimeout(r, 10));
    }
    return events;
  };
  return { ready, events, waitFor, close: () => req.destroy() };
}

test('expression= in a Streamer.bot address reaches the editor', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'easytuber-test-'));
  const srv = await start({ root: ROOT, saveFile: path.join(dir, 'avatar.json'), port: 18940 });
  const sse = listen(srv.port);
  await sse.ready;
  t.after(() => { sse.close(); srv.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  const json = { 'Content-Type': 'application/json' };
  const sb = (q, headers = { 'X-EasyTuber-Control': 'streamerbot' }) => request(srv.port, 'GET', '/api/streamerbot?' + q, undefined, headers);

  // before the editor has said which expressions there are
  assert.equal((await sb('expression=happy')).status, 404);
  assert.match((await sb('expression=happy')).body.error, /is the editor open/);

  const set = await request(srv.port, 'POST', '/api/actions', JSON.stringify({ actions: [{ id: 'wave', label: 'Wave', duration: 500 }], expressions: ['happy', 'very-angry_2'] }), json);
  assert.equal(set.status, 200);

  let r = await sb('expression=happy');
  assert.equal(r.status, 202);
  assert.deepEqual(r.body, { accepted: true, expression: 'happy' });
  r = await sb('expression=very-angry_2&for=2.5');
  assert.equal(r.status, 202);
  r = await sb('expression=off');
  assert.deepEqual(r.body, { accepted: true, expression: '' });
  const events = await sse.waitFor(3);
  assert.deepEqual(events.map((e) => [e.event, e.data]), [
    ['hotkey', { action: 'expression:happy', set: true, seconds: 0 }],
    ['hotkey', { action: 'expression:very-angry_2', set: true, seconds: 2.5 }],
    ['hotkey', { action: 'expression:off', set: true, seconds: 0 }],
  ]);

  // refused
  assert.equal((await sb('expression=sleepy')).status, 404);
  assert.equal((await sb('expression=happy&expression=very-angry_2')).status, 400);
  assert.equal((await sb('expression=happy&action=wave')).status, 400);
  assert.equal((await sb('expression=happy&user=bob')).status, 400);
  for (const bad of ['0', '-1', 'abc', '1.25', '99999', '']) assert.equal((await sb('expression=happy&for=' + bad)).status, 400, bad);
  assert.equal((await sb('expression=happy', {})).status, 403);       // no control header: a web page can't do it
  assert.equal((await sb('expression=happy', { 'X-EasyTuber-Control': 'streamerbot', Host: 'evil.example' })).status, 403);
  // a bad list is refused and the old one kept
  assert.equal((await request(srv.port, 'POST', '/api/actions', JSON.stringify({ actions: [], expressions: ['ok', 'not ok'] }), json)).status, 400);
  assert.equal((await sb('expression=happy')).status, 202);
  // actions still play, with their own values
  assert.equal((await sb('action=wave&user=bob')).status, 202);
  await sse.waitFor(5);
  assert.equal(sse.events[4].data.id, 'wave');
  // an older editor that sends no list: no expressions
  await request(srv.port, 'POST', '/api/actions', JSON.stringify({ actions: [] }), json);
  assert.equal((await sb('expression=happy')).status, 404);
});
