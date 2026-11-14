/* The "new version" notice: reading versions, asking GitHub (faked here), and the server's /api/update. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const update = require('../electron/update');
const { start } = require('../electron/server');

const ROOT = path.join(__dirname, '..');
const CURRENT = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
const tmp = (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'easytuber-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
};
const getJson = (port, p, headers = {}) => new Promise((resolve, reject) => {
  http.get({ host: '127.0.0.1', port, path: p, headers }, (res) => {
    let d = ''; res.on('data', (c) => d += c);
    res.on('end', () => { let body = null; try { body = JSON.parse(d); } catch (e) { /* not json */ } resolve({ status: res.statusCode, body }); });
  }).on('error', reject);
});
const answer = (status, data) => async () => ({ ok: status >= 200 && status < 300, status, json: async () => data });

test('versions are compared by number, not as text', () => {
  assert.equal(update.parse('v1.10.2').join(), '1,10,2');
  assert.equal(update.parse('1.2.3').join(), '1,2,3');
  for (const bad of ['', 'latest', '1.2', 'v1.2.3-beta', '1.2.3.4', null, undefined, 'v1.2.x']) assert.equal(update.parse(bad), null, String(bad));
  assert.equal(update.newer('1.10.0', '1.9.9'), true);
  assert.equal(update.newer('v2.0.0', '1.99.99'), true);
  assert.equal(update.newer('1.9.0', '1.10.0'), false);
  assert.equal(update.newer('1.10.0', '1.10.0'), false);
  assert.equal(update.newer('nonsense', '1.0.0'), false);
  assert.equal(update.newer('1.0.0', ''), false);
});

test('latest reads the release GitHub names, and gives nothing rather than fail', async () => {
  let asked = null;
  const ok = await update.latest(async (url, opts) => { asked = { url, opts }; return answer(200, { tag_name: 'v9.8.7', html_url: update.PAGE + '/tag/v9.8.7' })(); });
  assert.deepEqual(ok, { version: '9.8.7', url: update.PAGE + '/tag/v9.8.7' });
  assert.equal(asked.url, 'https://api.github.com/repos/pjcjonas/EasyTuber/releases/latest');
  assert.equal(asked.opts.headers['User-Agent'], 'EASY-TUBER');      // nothing about the user
  assert.equal(asked.opts.body, undefined);

  // a link that isn't this project's releases page is not passed on
  const odd = await update.latest(answer(200, { tag_name: 'v9.8.7', html_url: 'https://evil.example/download' }));
  assert.deepEqual(odd, { version: '9.8.7', url: update.PAGE });

  assert.equal(await update.latest(answer(404, {})), null);
  assert.equal(await update.latest(answer(200, { tag_name: 'nightly' })), null);
  assert.equal(await update.latest(answer(200, { tag_name: 'v9.0.0', prerelease: true })), null);
  assert.equal(await update.latest(answer(200, null)), null);
  assert.equal(await update.latest(async () => { throw new Error('offline'); }), null);
});

test('/api/update says the version, and asks GitHub only when told to, once', async (t) => {
  let asks = 0;
  const srv = await start({ root: ROOT, saveFile: path.join(tmp(t), 'avatar.easytuber.json'), port: 18920,
    latestRelease: async () => { asks++; return { version: '99.0.0', url: update.PAGE + '/tag/v99.0.0' }; } });
  t.after(() => srv.close());

  let r = await getJson(srv.port, '/api/update');
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { current: CURRENT, latest: null, url: update.PAGE, newer: false });
  assert.equal(asks, 0);                                              // the setting is off: nothing leaves the computer

  r = await getJson(srv.port, '/api/update?check=1');
  assert.deepEqual(r.body, { current: CURRENT, latest: '99.0.0', url: update.PAGE + '/tag/v99.0.0', newer: true });
  await getJson(srv.port, '/api/update?check=1');
  assert.equal(asks, 1);                                              // remembered

  assert.equal((await getJson(srv.port, '/api/update?check=1', { Host: 'evil.example' })).status, 403);
});

test('/api/update: same version, an older release, no answer, a strange answer', async (t) => {
  const dir = tmp(t);
  const cases = [
    [async () => ({ version: CURRENT, url: update.PAGE }), { latest: CURRENT, newer: false }],
    [async () => ({ version: '0.0.1', url: update.PAGE }), { latest: '0.0.1', newer: false }],
    [async () => null, { latest: null, newer: false }],
    [async () => { throw new Error('offline'); }, { latest: null, newer: false }],
    [async () => ({ version: '99.0.0', url: 'https://evil.example/x' }), { latest: '99.0.0', newer: true, url: update.PAGE }],
    [async () => ({ version: '<b>', url: update.PAGE }), { latest: null, newer: false }],
  ];
  let port = 18921;
  for (const [latestRelease, want] of cases) {
    const srv = await start({ root: ROOT, saveFile: path.join(dir, 'avatar.easytuber.json'), port: port++, latestRelease });
    const r = await getJson(srv.port, '/api/update?check=1');
    srv.close();
    assert.equal(r.status, 200);
    for (const [k, v] of Object.entries(want)) assert.equal(r.body[k], v, k);
  }
});

test('a failed check is tried again the next time', async (t) => {
  let asks = 0;
  const srv = await start({ root: ROOT, saveFile: path.join(tmp(t), 'avatar.easytuber.json'), port: 18930, latestRelease: async () => { asks++; return asks === 1 ? null : { version: '99.0.0', url: update.PAGE }; } });
  t.after(() => srv.close());
  assert.equal((await getJson(srv.port, '/api/update?check=1')).body.newer, false);
  assert.equal((await getJson(srv.port, '/api/update?check=1')).body.newer, true);
  assert.equal(asks, 2);
});
