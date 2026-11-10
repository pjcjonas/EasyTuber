const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { start, validBinding } = require('../electron/server');

const ROOT = path.join(__dirname, '..');

test('validBinding accepts what the editor produces', () => {
  for (const accelerator of ['Ctrl+Alt+1', 'Ctrl+Shift+A', 'Alt+F5', 'F9', 'F24', 'num7', 'numadd', 'Super+Space', 'Cmd+Shift+Up', 'Ctrl+Alt+-']) {
    assert.ok(validBinding({ accelerator, action: 'next' }), accelerator);
  }
  assert.ok(validBinding({ accelerator: 'Ctrl+1', action: 'avatar:a1' }));
  assert.ok(validBinding({ accelerator: 'Ctrl+1', action: 'avatar:almx0k3ab9z' }));
  assert.ok(validBinding({ accelerator: 'Ctrl+1', action: 'random' }));
});

test('validBinding refuses bare keys, junk and unknown actions', () => {
  const bad = [
    { accelerator: 'A', action: 'next' },                 // would swallow "a" in every program
    { accelerator: '1', action: 'next' },
    { accelerator: 'Space', action: 'next' },
    { accelerator: 'Ctrl+Ctrl+A', action: 'next' },
    { accelerator: 'Hyper+A', action: 'next' },
    { accelerator: 'Ctrl+', action: 'next' },
    { accelerator: 'Ctrl+F25', action: 'next' },
    { accelerator: 'Ctrl+1', action: 'quit' },
    { accelerator: 'Ctrl+1', action: 'avatar:' },
    { accelerator: 'Ctrl+1', action: 'avatar:../../x' },
    { accelerator: 'x'.repeat(70), action: 'next' },
    { accelerator: 1, action: 'next' },
    null,
  ];
  for (const b of bad) assert.equal(validBinding(b), false, JSON.stringify(b));
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

test('/api/hotkeys registers through the app and the press reaches the pages', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'easytuber-test-'));
  let got = null;
  const srv = await start({
    root: ROOT, saveFile: path.join(dir, 'avatar.json'), port: 18777,
    onHotkeys: (list) => { got = list; return list.map((b) => ({ accelerator: b.accelerator, ok: b.accelerator !== 'Ctrl+Alt+9' })); },
  });
  t.after(() => { srv.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  const json = { 'Content-Type': 'application/json' };

  const bindings = [{ accelerator: 'Ctrl+Alt+1', action: 'avatar:a1' }, { accelerator: 'Ctrl+Alt+9', action: 'random' }];
  const ok = await request(srv.port, 'POST', '/api/hotkeys', JSON.stringify({ bindings }), json);
  assert.equal(ok.status, 200);
  assert.deepEqual(JSON.parse(ok.body).results, [{ accelerator: 'Ctrl+Alt+1', ok: true }, { accelerator: 'Ctrl+Alt+9', ok: false }]);
  assert.deepEqual(got, bindings);

  // not JSON (what another website could send without a preflight): refused, nothing registered
  got = null;
  const plain = await request(srv.port, 'POST', '/api/hotkeys', JSON.stringify({ bindings }), { 'Content-Type': 'text/plain' });
  assert.equal(plain.status, 415);
  assert.equal(got, null);

  const bare = await request(srv.port, 'POST', '/api/hotkeys', JSON.stringify({ bindings: [{ accelerator: 'A', action: 'next' }] }), json);
  assert.equal(bare.status, 400);
  assert.equal(got, null);

  // a press, broadcast by the app, arrives on the event stream
  const event = await new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port: srv.port, path: '/api/events' }, (res) => {
      let buf = '';
      res.on('data', (c) => {
        buf += c;
        if (buf.includes('event: hello')) srv.broadcast('hotkey', { action: 'next' });
        const m = /event: hotkey\ndata: (.*)\n/.exec(buf);
        if (m) { req.destroy(); resolve(JSON.parse(m[1])); }
      });
    });
    req.on('error', reject);
  });
  assert.deepEqual(event, { action: 'next' });
});

test('/api/hotkeys says so when the app has no global hotkeys', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'easytuber-test-'));
  const srv = await start({ root: ROOT, saveFile: path.join(dir, 'avatar.json'), port: 18790 });
  t.after(() => { srv.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  const r = await request(srv.port, 'POST', '/api/hotkeys', JSON.stringify({ bindings: [] }), { 'Content-Type': 'application/json' });
  assert.equal(r.status, 501);
});
