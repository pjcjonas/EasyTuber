/* Backups of the avatar file: the backups module, the server's /api/backups routes, and that the
   pictures a backup names are not tidied away. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const backups = require('../electron/backups');
const images = require('../electron/images');
const { start } = require('../electron/server');

const ROOT = path.join(__dirname, '..');
const tmp = (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'easytuber-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
};
const project = (n) => JSON.stringify({ version: 1, name: 'P' + n, savedAt: n, parts: { torso: { images: {} } } });

function request(port, method, p, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path: p, headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString() }));
    });
    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}
const JSON_TYPE = { 'Content-Type': 'application/json' };

test('make copies the avatar file, and not twice when nothing changed', async (t) => {
  const saveFile = path.join(tmp(t), 'avatar.easytuber.json');
  assert.equal(await backups.make(saveFile, 'start'), null);            // no avatar yet
  assert.deepEqual(await backups.list(saveFile), []);

  fs.writeFileSync(saveFile, project(1));
  const first = await backups.make(saveFile, 'start', { now: 1700000000000 });
  assert.equal(first.id, 'backup-1700000000000-start');
  assert.equal(first.reason, 'start');
  assert.equal(await backups.read(saveFile, first.id), project(1));
  assert.equal(await backups.make(saveFile, 'reset', { now: 1700000000500 }), null);   // the same avatar is already kept

  fs.writeFileSync(saveFile, project(2));
  const second = await backups.make(saveFile, 'reset', { now: 1700000001000 });
  assert.equal((await backups.list(saveFile)).map((b) => b.id).join(), [second.id, first.id].join());   // newest first
  assert.equal(fs.readFileSync(saveFile, 'utf8'), project(2));          // the avatar file itself is untouched
  assert.equal(fs.readdirSync(path.dirname(saveFile)).filter((f) => f.endsWith('.tmp')).length, 0);
});

test('only the newest five are kept', async (t) => {
  const saveFile = path.join(tmp(t), 'avatar.easytuber.json');
  for (let i = 1; i <= 8; i++) {
    fs.writeFileSync(saveFile, project(i));
    await backups.make(saveFile, 'start', { now: 1700000000000 + i * 1000 });
  }
  const list = await backups.list(saveFile);
  assert.equal(list.length, backups.KEEP);
  const names = [];
  for (const b of list) names.push(JSON.parse(await backups.read(saveFile, b.id)).name);
  assert.equal(names.join(), 'P8,P7,P6,P5,P4');
});

test('a clock that went backwards still makes the newest backup', async (t) => {
  const saveFile = path.join(tmp(t), 'avatar.easytuber.json');
  fs.writeFileSync(saveFile, project(1));
  await backups.make(saveFile, 'start', { now: 1700000005000 });
  fs.writeFileSync(saveFile, project(2));
  const later = await backups.make(saveFile, 'reset', { now: 1700000000000 });
  assert.equal((await backups.list(saveFile))[0].id, later.id);
  assert.equal(JSON.parse(await backups.read(saveFile, later.id)).name, 'P2');
});

test('a broken avatar file is not backed up, and odd names are refused', async (t) => {
  const saveFile = path.join(tmp(t), 'avatar.easytuber.json');
  fs.writeFileSync(saveFile, project(1));
  await backups.make(saveFile, 'start', { now: 1700000000000 });
  fs.writeFileSync(saveFile, '{"parts": {');                           // cut off mid-write
  assert.equal(await backups.make(saveFile, 'start', { now: 1700000001000 }), null);
  fs.writeFileSync(saveFile, '{"hello":1}');                           // not an avatar
  assert.equal(await backups.make(saveFile, 'start', { now: 1700000002000 }), null);
  assert.equal((await backups.list(saveFile)).length, 1);

  await assert.rejects(backups.make(saveFile, 'whatever'));
  await assert.rejects(backups.read(saveFile, '../avatar.easytuber.json'));
  await assert.rejects(backups.read(saveFile, 'backup-1700000009999-start'));   // well formed, not there
  // files beside the avatar that are not backups are not listed
  fs.writeFileSync(saveFile + '.before-images.bak', project(0));
  fs.writeFileSync(saveFile + '.backup-123-start', project(0));
  assert.equal((await backups.list(saveFile)).length, 1);
});

test('pictures named only by a backup are not tidied away', async (t) => {
  const dir = tmp(t), saveFile = path.join(dir, 'avatar.easytuber.json'), imagesDir = path.join(dir, 'images');
  const a = 'a'.repeat(64), b = 'b'.repeat(64);
  fs.mkdirSync(imagesDir);
  for (const h of [a, b]) fs.writeFileSync(path.join(imagesDir, h), 'x');
  const old = new Date(Date.now() - images.KEEP_UNUSED_MS - 60000);
  for (const h of [a, b]) fs.utimesSync(path.join(imagesDir, h), old, old);
  fs.writeFileSync(saveFile, JSON.stringify({ parts: { torso: { images: { main: 'img:' + a } } } }));
  await backups.make(saveFile, 'reset');
  fs.writeFileSync(saveFile, JSON.stringify({ parts: { torso: { images: {} } } }));   // after the reset nothing names it
  assert.deepEqual(await images.sweep(saveFile, imagesDir), [b]);
  assert.deepEqual(fs.readdirSync(imagesDir), [a]);
});

test('the server backs the avatar up when it starts, and on request', async (t) => {
  const dir = tmp(t), saveFile = path.join(dir, 'avatar.easytuber.json');
  fs.writeFileSync(saveFile, project(1));
  const srv = await start({ root: ROOT, saveFile, port: 18910 });
  t.after(() => srv.close());
  const port = srv.port;

  let r = await request(port, 'GET', '/api/backups');
  assert.equal(r.status, 200);
  let list = JSON.parse(r.body).backups;
  assert.equal(list.length, 1);
  assert.equal(list[0].reason, 'start');

  // the editor saves, then asks for a backup before a reset
  assert.equal((await request(port, 'PUT', '/api/project', project(2), JSON_TYPE)).status, 200);
  r = await request(port, 'POST', '/api/backups', JSON.stringify({ reason: 'reset' }), JSON_TYPE);
  assert.equal(r.status, 200);
  const made = JSON.parse(r.body);
  assert.equal(made.backup.reason, 'reset');
  assert.equal(made.backups.length, 2);

  r = await request(port, 'GET', '/api/backups/' + made.backup.id);
  assert.equal(r.status, 200);
  assert.equal(r.body, project(2));
  r = await request(port, 'GET', '/api/backups/' + list[0].id);
  assert.equal(r.body, project(1));

  // asked again with nothing changed: no new backup, and no error
  r = await request(port, 'POST', '/api/backups', JSON.stringify({ reason: 'restore' }), JSON_TYPE);
  assert.equal(r.status, 200);
  assert.equal(JSON.parse(r.body).backup, null);
  assert.equal(JSON.parse(r.body).backups.length, 2);

  // refused: not JSON (what a web page can send without asking), an unknown reason, a made-up name
  assert.equal((await request(port, 'POST', '/api/backups', 'reason=reset', { 'Content-Type': 'text/plain' })).status, 415);
  assert.equal((await request(port, 'POST', '/api/backups', JSON.stringify({ reason: 'start' }), JSON_TYPE)).status, 400);
  assert.equal((await request(port, 'GET', '/api/backups/backup-1700000009999-start')).status, 404);
  assert.equal((await request(port, 'GET', '/api/backups/..%2Favatar.easytuber.json')).status, 404);
  assert.equal((await request(port, 'GET', '/api/backups', undefined, { Host: 'evil.example' })).status, 403);
});

test('starting twice on an unchanged avatar keeps one backup', async (t) => {
  const dir = tmp(t), saveFile = path.join(dir, 'avatar.easytuber.json');
  fs.writeFileSync(saveFile, project(1));
  for (const port of [18911, 18912]) {
    const srv = await start({ root: ROOT, saveFile, port });
    srv.close();
  }
  assert.equal((await backups.list(saveFile)).length, 1);
});
