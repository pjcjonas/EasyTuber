/* Pictures as files: the images module (types, storing, moving them out of an old avatar file,
   tidying), the server's /api/image routes, and the page-side helpers. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const vm = require('node:vm');
const crypto = require('node:crypto');
const images = require('../electron/images');
const { start } = require('../electron/server');

const ROOT = path.join(__dirname, '..');
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const tmp = (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'easytuber-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
};

// a real 1 x 1 PNG, and a second, different one
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const PNG2 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const dataUrl = (buf, type = 'image/png') => `data:${type};base64,${buf.toString('base64')}`;

/* an avatar file the way v1.8 and earlier wrote it: every picture inside it */
function oldProject() {
  return {
    version: 1, name: 'Old', savedAt: 1234,
    parts: {
      torso: { images: { main: dataUrl(PNG) }, x: 1 },
      eyes: { images: { open: dataUrl(PNG2), closed: dataUrl(PNG) } },
      face: { images: {} },
    },
    sheets: [{ id: 's1', url: dataUrl(PNG2), boxes: [] }],
    avatars: [
      { id: 'a1', name: 'One', look: null },
      { id: 'a2', name: 'Two', look: { parts: { torso: { images: { main: dataUrl(PNG) } } }, sheets: [{ id: 's2', url: dataUrl(PNG), boxes: [] }] } },
    ],
    note: 'data:image/png;base64,not-a-picture!!',
  };
}

test('typeOf knows a picture by how it starts', () => {
  assert.equal(images.typeOf(PNG), 'image/png');
  assert.equal(images.typeOf(Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(20)])), 'image/jpeg');
  assert.equal(images.typeOf(Buffer.from('RIFF\0\0\0\0WEBPVP8 ' + 'x'.repeat(10), 'latin1')), 'image/webp');
  assert.equal(images.typeOf(Buffer.from('GIF89a' + 'x'.repeat(10), 'latin1')), 'image/gif');
  assert.equal(images.typeOf(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>')), 'image/svg+xml');
  assert.equal(images.typeOf(Buffer.from('<?xml version="1.0"?>\n<!-- made by hand -->\n<svg width="1"></svg>')), 'image/svg+xml');
  for (const not of ['<html><script>alert(1)</script></html>', 'hello there, world', '{"parts":{}}  ', 'MZ' + 'x'.repeat(20)]) {
    assert.equal(images.typeOf(Buffer.from(not)), '', not);
  }
  assert.equal(images.typeOf(Buffer.alloc(0)), '');
  assert.equal(images.typeOf(null), '');
});

test('store keeps a picture under its hash, once', async (t) => {
  const dir = path.join(tmp(t), 'images');
  const file = await images.store(dir, sha(PNG), PNG);
  assert.equal(path.basename(file), sha(PNG));
  assert.deepEqual(fs.readFileSync(file), PNG);
  const before = fs.statSync(file).mtimeMs;
  await images.store(dir, sha(PNG), Buffer.from('something else'));     // already there: left alone
  assert.deepEqual(fs.readFileSync(file), PNG);
  assert.equal(fs.statSync(file).mtimeMs, before);
  assert.deepEqual(fs.readdirSync(dir), [sha(PNG)]);                    // no temporary files left behind
  await assert.rejects(images.store(dir, '../escape', PNG));
  assert.deepEqual(await images.head(file), { size: PNG.length, type: 'image/png' });
  await assert.rejects(images.head(path.join(dir, sha(PNG2))));
});

test('migrate moves the pictures out of an old avatar file and keeps the old file as a backup', async (t) => {
  const dir = tmp(t), saveFile = path.join(dir, 'avatar.easytuber.json'), imagesDir = path.join(dir, 'images');
  const before = JSON.stringify(oldProject());
  fs.writeFileSync(saveFile, before);

  const res = await images.migrate(saveFile, imagesDir);
  assert.equal(res.count, 6);                                            // six places held a picture
  assert.equal(res.backup, saveFile + '.before-images.bak');
  assert.equal(fs.readFileSync(res.backup, 'utf8'), before);             // the old file, byte for byte

  // two different pictures, each stored once
  assert.deepEqual(fs.readdirSync(imagesDir).sort(), [sha(PNG), sha(PNG2)].sort());
  assert.deepEqual(fs.readFileSync(path.join(imagesDir, sha(PNG))), PNG);
  assert.deepEqual(fs.readFileSync(path.join(imagesDir, sha(PNG2))), PNG2);

  const now = JSON.parse(fs.readFileSync(saveFile, 'utf8'));
  const A = 'img:' + sha(PNG), B = 'img:' + sha(PNG2);
  const want = oldProject();
  want.parts.torso.images.main = A; want.parts.eyes.images = { open: B, closed: A };
  want.sheets[0].url = B; want.avatars[1].look.parts.torso.images.main = A; want.avatars[1].look.sheets[0].url = A;
  assert.deepEqual(now, want);                                           // nothing else changed, the odd string included
  assert.ok(fs.statSync(saveFile).size < before.length);
  assert.equal(fs.existsSync(saveFile + '.tmp'), false);

  // a second start has nothing to do, and makes no second backup
  assert.deepEqual(await images.migrate(saveFile, imagesDir), { count: 0, backup: '' });
  assert.deepEqual(fs.readdirSync(dir).sort(), ['avatar.easytuber.json', 'avatar.easytuber.json.before-images.bak', 'images']);

  // putting the pictures back gives the old project again
  const back = JSON.parse(fs.readFileSync(saveFile, 'utf8'));
  const restore = (node) => {
    for (const k of Object.keys(node)) {
      if (typeof node[k] === 'string' && /^img:[0-9a-f]{64}$/.test(node[k])) node[k] = dataUrl(fs.readFileSync(path.join(imagesDir, node[k].slice(4))));
      else if (node[k] && typeof node[k] === 'object') restore(node[k]);
    }
  };
  restore(back);
  assert.deepEqual(back, oldProject());
});

test('migrate leaves alone what it should', async (t) => {
  const dir = tmp(t), imagesDir = path.join(dir, 'images');
  const file = (name, text) => { const f = path.join(dir, name); fs.writeFileSync(f, text); return f; };

  assert.deepEqual(await images.migrate(path.join(dir, 'none.json'), imagesDir), { count: 0, backup: '' });      // no avatar yet
  const small = file('new.json', JSON.stringify({ parts: { torso: { images: { main: 'img:' + sha(PNG) } } } }));
  assert.deepEqual(await images.migrate(small, imagesDir), { count: 0, backup: '' });                             // already done
  const other = file('other.json', JSON.stringify({ hello: dataUrl(PNG) }));
  assert.deepEqual(await images.migrate(other, imagesDir), { count: 0, backup: '' });                             // not an avatar
  assert.equal(fs.existsSync(imagesDir), false);

  // a broken file is not touched, and the error is the caller's to report
  const broken = file('broken.json', '{"parts": {"torso": {"images": {"main": "data:image/png;base64,AAAA"');
  await assert.rejects(images.migrate(broken, imagesDir));
  assert.equal(fs.readFileSync(broken, 'utf8'), '{"parts": {"torso": {"images": {"main": "data:image/png;base64,AAAA"');
  assert.deepEqual(fs.readdirSync(dir).sort(), ['broken.json', 'new.json', 'other.json']);

  // a second backup never overwrites the first
  const again = file('again.json', JSON.stringify(oldProject()));
  fs.writeFileSync(again + '.before-images.bak', 'an earlier backup');
  const res = await images.migrate(again, imagesDir);
  assert.equal(res.backup, again + '.before-images-2.bak');
  assert.equal(fs.readFileSync(again + '.before-images.bak', 'utf8'), 'an earlier backup');
});

test('sweep removes only pictures nothing has used for a month', async (t) => {
  const dir = tmp(t), saveFile = path.join(dir, 'avatar.easytuber.json'), imagesDir = path.join(dir, 'images');
  fs.mkdirSync(imagesDir);
  const put = (label, ageDays) => {
    const bytes = Buffer.concat([PNG, Buffer.from(label)]), name = sha(bytes), f = path.join(imagesDir, name);
    fs.writeFileSync(f, bytes);
    const when = new Date(Date.now() - ageDays * 24 * 3600 * 1000);
    fs.utimesSync(f, when, when);
    return name;
  };
  const used = put('used', 90), inBackup = put('in a backup', 90), fresh = put('unused but new', 3), stale = put('unused and old', 90);
  fs.writeFileSync(path.join(imagesDir, 'notes.txt'), 'not ours');
  fs.writeFileSync(saveFile, JSON.stringify({ parts: { torso: { images: { main: 'img:' + used } } } }));
  fs.writeFileSync(saveFile + '.backup-1.json', JSON.stringify({ parts: { torso: { images: { main: 'img:' + inBackup } } } }));

  assert.deepEqual(await images.sweep(saveFile, imagesDir), [stale]);
  assert.deepEqual(fs.readdirSync(imagesDir).sort(), [used, inBackup, fresh, 'notes.txt'].sort());

  // an avatar file that can't be read means "don't know what is used": remove nothing
  const stale2 = put('another old one', 90);
  fs.writeFileSync(saveFile, '{ not json');
  assert.deepEqual(await images.sweep(saveFile, imagesDir), []);
  fs.writeFileSync(saveFile, JSON.stringify({ something: 'else' }));
  assert.deepEqual(await images.sweep(saveFile, imagesDir), []);
  fs.rmSync(saveFile);
  assert.deepEqual(await images.sweep(saveFile, imagesDir), []);
  assert.ok(fs.existsSync(path.join(imagesDir, stale2)));
  assert.deepEqual(await images.sweep(saveFile, path.join(dir, 'no-such-folder')), []);
});

/* ---------------- the server ---------------- */

function request(port, method, p, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path: p, headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

test('/api/image stores a picture under its hash and sends it back', async (t) => {
  const dir = tmp(t);
  const srv = await start({ root: ROOT, saveFile: path.join(dir, 'avatar.easytuber.json'), port: 18900 });
  t.after(() => srv.close());
  assert.equal(srv.imagesDir, path.join(dir, 'images'));
  const url = '/api/image/' + sha(PNG);

  assert.equal((await request(srv.port, 'GET', url)).status, 404);
  assert.equal((await request(srv.port, 'PUT', url, PNG)).status, 200);
  assert.equal((await request(srv.port, 'PUT', url, PNG)).status, 200);                 // again: fine
  const got = await request(srv.port, 'GET', url);
  assert.equal(got.status, 200);
  assert.deepEqual(got.body, PNG);
  assert.equal(got.headers['content-type'], 'image/png');
  assert.match(got.headers['cache-control'], /immutable/);
  assert.equal(got.headers['x-content-type-options'], 'nosniff');
  assert.match(got.headers['content-security-policy'], /sandbox/);

  // the name has to be the hash of what is sent, and it has to be a picture
  assert.equal((await request(srv.port, 'PUT', '/api/image/' + sha(PNG2), PNG)).status, 400);
  const html = Buffer.from('<html><script>alert(1)</script></html>');
  assert.equal((await request(srv.port, 'PUT', '/api/image/' + sha(html), html)).status, 415);
  for (const bad of ['/api/image/abc', '/api/image/' + 'g'.repeat(64), '/api/image/' + sha(PNG).toUpperCase(), '/api/image/..%2favatar.easytuber.json', '/api/image/' + sha(PNG) + '/x']) {
    const r = await request(srv.port, 'GET', bad);
    assert.ok(r.status === 404 || r.status === 400, `${bad} -> ${r.status}`);
  }
  assert.equal((await request(srv.port, 'GET', url, undefined, { Host: 'evil.example' })).status, 403);
  assert.equal((await request(srv.port, 'DELETE', url)).status, 405);
  assert.deepEqual(fs.readdirSync(srv.imagesDir), [sha(PNG)]);

  // an SVG is sent as one, with the headers that stop it running anything when opened by itself
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
  assert.equal((await request(srv.port, 'PUT', '/api/image/' + sha(svg), svg)).status, 200);
  const s = await request(srv.port, 'GET', '/api/image/' + sha(svg));
  assert.equal(s.headers['content-type'], 'image/svg+xml');
  assert.match(s.headers['content-security-policy'], /default-src 'none'/);
});

test('starting the server moves the pictures out of an old avatar file before any page reads it', async (t) => {
  const dir = tmp(t), saveFile = path.join(dir, 'avatar.easytuber.json');
  fs.writeFileSync(saveFile, JSON.stringify(oldProject()));
  const srv = await start({ root: ROOT, saveFile, port: 18901 });
  t.after(() => srv.close());

  const project = JSON.parse((await request(srv.port, 'GET', '/api/project')).body);
  assert.equal(project.parts.torso.images.main, 'img:' + sha(PNG));
  assert.equal(JSON.stringify(project).includes('data:image/png;base64,iVBOR'), false);
  const pic = await request(srv.port, 'GET', '/api/image/' + sha(PNG2));
  assert.deepEqual(pic.body, PNG2);
  assert.ok(fs.existsSync(saveFile + '.before-images.bak'));
});

test('a broken avatar file does not stop the server from starting', async (t) => {
  const dir = tmp(t), saveFile = path.join(dir, 'avatar.easytuber.json');
  const brokenText = '{"parts": {"torso": {"images": {"main": "data:image/png;base64,AAAA"';
  fs.writeFileSync(saveFile, brokenText);
  const err = console.error;
  console.error = () => {};
  t.after(() => { console.error = err; });
  const srv = await start({ root: ROOT, saveFile, port: 18902 });
  t.after(() => srv.close());
  assert.equal((await request(srv.port, 'GET', '/api/ping')).status, 200);
  assert.equal(fs.readFileSync(saveFile, 'utf8'), brokenText);           // untouched
});

/* ---------------- the page side ---------------- */

function loadPT() {
  const ctx = { window: {}, navigator: { platform: 'Win32' }, structuredClone, console, performance, indexedDB: {}, location: { protocol: 'http:' } };
  ctx.window = ctx;
  vm.createContext(ctx);
  for (const f of ['util.js', 'defs.js', 'assets.js', 'storage.js']) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', f), 'utf8'), ctx, { filename: f });
  }
  return ctx.PT;
}

test('the page tells a stored picture from one inside the project, and finds every picture in a project', () => {
  const PT = loadPT();
  const ref = 'img:' + sha(PNG);
  assert.equal(PT.isImageRef(ref), true);
  for (const not of ['img:abc', dataUrl(PNG), 'media/intro.mp4', '', null, 7, ref + 'x', 'IMG:' + sha(PNG)]) assert.equal(PT.isImageRef(not), false, String(not));
  assert.equal(PT.imageSrc(ref), 'api/image/' + sha(PNG));
  assert.equal(PT.imageSrc(dataUrl(PNG)), dataUrl(PNG));

  const p = oldProject();
  const slots = PT.Storage.pictureSlots(p);
  assert.equal(slots.length, 6);
  for (const [obj, key] of slots) obj[key] = 'seen';
  assert.equal(JSON.stringify(p).includes('data:image/png;base64,iVBOR'), false);   // every picture was reached
  assert.equal(p.note, 'data:image/png;base64,not-a-picture!!');                      // and nothing that isn't one
  assert.equal(PT.Storage.pictureSlots(null).length, 0);
  assert.equal(PT.Storage.pictureSlots({ parts: null, avatars: [null, { look: 5 }] }).length, 0);

  // the same picture under its two names is not loaded twice
  PT.Assets.aliases.set(ref, dataUrl(PNG));
  assert.equal(PT.Assets.samePicture(ref, dataUrl(PNG)), true);
  assert.equal(PT.Assets.samePicture(dataUrl(PNG), ref), true);
  assert.equal(PT.Assets.samePicture(ref, ref), true);
  assert.equal(PT.Assets.samePicture(ref, dataUrl(PNG2)), false);
});
