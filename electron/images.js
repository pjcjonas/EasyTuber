/* The avatar's pictures, kept as files.

   The avatar file (avatar.easytuber.json) used to hold every picture as a data URL, so it grew to
   tens of megabytes and every small edit rewrote all of it. Now each picture is a file in the
   images folder beside the avatar file, named by the SHA-256 of its bytes, and the avatar file
   says "img:<hash>" where the picture goes. The same picture used by several avatars is stored once.

   A picture file is never changed. It is only removed by sweep(), a month after nothing uses it. */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MAX_BYTES = 64 * 1024 * 1024;           // one picture
const KEEP_UNUSED_MS = 30 * 24 * 3600 * 1000; // how long a picture nothing uses is kept
const HASH = /^[0-9a-f]{64}$/;
const REF = /img:([0-9a-f]{64})/g;
const DATA_URL = /^data:image\/[a-z0-9.+-]+;base64,/i;

/* What kind of picture these bytes are, from how they start: a media type, or '' if none we show. */
function typeOf(buf) {
  if (!buf || buf.length < 12) return '';
  if (buf[0] === 0x89 && buf.toString('latin1', 1, 4) === 'PNG') return 'image/png';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') return 'image/webp';
  if (/^GIF8[79]a/.test(buf.toString('latin1', 0, 6))) return 'image/gif';
  if (buf.toString('latin1', 0, 2) === 'BM') return 'image/bmp';
  if (buf.toString('latin1', 4, 12) === 'ftypavif') return 'image/avif';
  if (/^(﻿)?\s*(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*(<!DOCTYPE[^>]*>\s*)?<svg[\s>]/i.test(buf.toString('utf8', 0, Math.min(buf.length, 4096)))) return 'image/svg+xml';
  return '';
}

/* Keep a picture. Writing the same picture twice is fine: the name says what is in it. */
async function store(dir, hash, bytes) {
  if (!HASH.test(hash)) throw new Error('bad picture name');
  const file = path.join(dir, hash);
  try { await fs.promises.access(file); return file; } catch (e) { /* not there yet */ }
  await fs.promises.mkdir(dir, { recursive: true });
  const tmp = file + '.' + process.pid + '.tmp';
  await fs.promises.writeFile(tmp, bytes);
  await fs.promises.rename(tmp, file);
  return file;
}

/* Size and type of a stored picture. Throws if it isn't there. */
async function head(file) {
  const st = await fs.promises.stat(file);
  if (!st.isFile()) throw new Error('not a file');
  const fd = await fs.promises.open(file, 'r');
  try {
    const buf = Buffer.alloc(Math.min(4096, st.size));
    await fd.read(buf, 0, buf.length, 0);
    return { size: st.size, type: typeOf(buf) };
  } finally { await fd.close(); }
}

/* Every picture inside a project, wherever it is: fn(dataUrl) -> its replacement. Returns how many. */
function replacePictures(node, fn) {
  let n = 0;
  if (Array.isArray(node)) { for (let i = 0; i < node.length; i++) n += visit(node, i); } else if (node && typeof node === 'object') { for (const k of Object.keys(node)) n += visit(node, k); }
  return n;
  function visit(owner, key) {
    const v = owner[key];
    if (typeof v === 'string') {
      if (!DATA_URL.test(v)) return 0;
      const next = fn(v);
      if (next === v) return 0;
      owner[key] = next;
      return 1;
    }
    return replacePictures(v, fn);
  }
}

/* An avatar file from before pictures were files: move its pictures out to the images folder and
   leave "img:<hash>" in their place. The file as it was is kept beside it as a backup, and if
   anything goes wrong the file is left untouched. Returns { count, backup }. */
async function migrate(saveFile, dir) {
  let text;
  try { text = await fs.promises.readFile(saveFile, 'utf8'); } catch (e) { return { count: 0, backup: '' }; }   // no avatar yet
  if (!text.includes('data:image/')) return { count: 0, backup: '' };
  const project = JSON.parse(text);
  if (!project || typeof project !== 'object' || !project.parts) return { count: 0, backup: '' };

  const pending = new Map();   // hash -> bytes
  const count = replacePictures(project, (url) => {
    const bytes = Buffer.from(url.slice(url.indexOf(',') + 1), 'base64');
    if (!bytes.length || bytes.length > MAX_BYTES || !typeOf(bytes)) return url;   // not a picture we know: leave it where it is
    const hash = crypto.createHash('sha256').update(bytes).digest('hex');
    pending.set(hash, bytes);
    return 'img:' + hash;
  });
  if (!count) return { count: 0, backup: '' };

  // the pictures first, then the backup, then the new file: at every step the avatar is whole
  for (const [hash, bytes] of pending) await store(dir, hash, bytes);
  for (const hash of pending.keys()) {
    const written = await fs.promises.readFile(path.join(dir, hash));
    if (crypto.createHash('sha256').update(written).digest('hex') !== hash) throw new Error('a picture did not survive being written: ' + hash);
  }
  let backup = saveFile + '.before-images.bak';
  for (let i = 2; fs.existsSync(backup); i++) backup = `${saveFile}.before-images-${i}.bak`;
  await fs.promises.copyFile(saveFile, backup);
  const tmp = saveFile + '.tmp';
  await fs.promises.writeFile(tmp, JSON.stringify(project));
  await fs.promises.rename(tmp, saveFile);
  return { count, backup };
}

/* The pictures a file's text mentions. */
function refsIn(text) {
  const out = new Set();
  for (const m of text.matchAll(REF)) out.add(m[1]);
  return out;
}

/* Remove pictures that nothing has used for a month. "Used" = named by the avatar file or by any
   backup of it in the same folder. If the avatar file can't be read, nothing is removed.
   Returns the names removed. */
async function sweep(saveFile, dir, now = Date.now()) {
  let names;
  try { names = await fs.promises.readdir(dir); } catch (e) { return []; }
  let text;
  try { text = await fs.promises.readFile(saveFile, 'utf8'); } catch (e) { return []; }
  let ok = false;
  try { const p = JSON.parse(text); ok = !!(p && typeof p === 'object' && p.parts); } catch (e) { ok = false; }
  if (!ok) return [];
  const used = refsIn(text);
  // backups made by the app sit beside the avatar file and start with its name
  const folder = path.dirname(saveFile), base = path.basename(saveFile);
  for (const f of await fs.promises.readdir(folder)) {
    if (f === base || !f.startsWith(base) || f.endsWith('.tmp')) continue;
    try { for (const h of refsIn(await fs.promises.readFile(path.join(folder, f), 'utf8'))) used.add(h); } catch (e) { return []; }   // unsure: remove nothing
  }
  const removed = [];
  for (const name of names) {
    if (!HASH.test(name) || used.has(name)) continue;
    const file = path.join(dir, name);
    try {
      const st = await fs.promises.stat(file);
      if (!st.isFile() || now - st.mtimeMs < KEEP_UNUSED_MS) continue;
      await fs.promises.unlink(file);
      removed.push(name);
    } catch (e) { /* leave it */ }
  }
  return removed;
}

module.exports = { MAX_BYTES, KEEP_UNUSED_MS, typeOf, store, head, replacePictures, migrate, sweep, refsIn };
