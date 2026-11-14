/* Backups of the avatar file.

   A backup is a copy of avatar.easytuber.json, kept beside it as
   avatar.easytuber.json.backup-<time in ms>-<why>. One is made when the app starts and one before
   anything that throws the avatar away (Reset, restoring an older backup). The newest KEEP are kept.

   Backups hold the avatar file only. The pictures it names stay in the images folder for as long
   as a backup names them (see sweep() in images.js). */
const fs = require('fs');
const path = require('path');

const KEEP = 5;
const REASONS = ['start', 'reset', 'restore'];
const ID = /^backup-(\d{13})-(start|reset|restore)$/;

const fileOf = (saveFile, id) => `${saveFile}.${id}`;

/* The backups there are, newest first: [{ id, at, reason, size }]. */
async function list(saveFile) {
  const folder = path.dirname(saveFile), base = path.basename(saveFile) + '.';
  let names;
  try { names = await fs.promises.readdir(folder); } catch (e) { return []; }
  const out = [];
  for (const name of names) {
    if (!name.startsWith(base)) continue;
    const m = ID.exec(name.slice(base.length));
    if (!m) continue;
    try {
      const st = await fs.promises.stat(path.join(folder, name));
      if (st.isFile()) out.push({ id: m[0], at: +m[1], reason: m[2], size: st.size });
    } catch (e) { /* gone meanwhile */ }
  }
  return out.sort((a, b) => b.at - a.at);
}

/* Copy the avatar file as it is now. Nothing is made when there is no avatar yet, when the file
   isn't a readable avatar (a backup of a broken file would push a good one out), or when the
   newest backup already holds exactly this. Returns the new entry, or null. */
async function make(saveFile, reason, { keep = KEEP, now = Date.now() } = {}) {
  if (!REASONS.includes(reason)) throw new Error('unknown reason');
  let text;
  try { text = await fs.promises.readFile(saveFile, 'utf8'); } catch (e) { return null; }
  try { const p = JSON.parse(text); if (!p || typeof p !== 'object' || !p.parts) return null; } catch (e) { return null; }
  const have = await list(saveFile);
  if (have.length) {
    try { if (await fs.promises.readFile(fileOf(saveFile, have[0].id), 'utf8') === text) return null; } catch (e) { /* make a new one */ }
  }
  let at = Math.max(now, have.length ? have[0].at + 1 : 0);   // always newer than the newest, whatever the clock says
  const id = `backup-${String(at).padStart(13, '0')}-${reason}`;
  const tmp = fileOf(saveFile, id) + '.tmp';
  await fs.promises.writeFile(tmp, text);
  await fs.promises.rename(tmp, fileOf(saveFile, id));
  for (const old of have.slice(Math.max(0, keep - 1))) {
    try { await fs.promises.unlink(fileOf(saveFile, old.id)); } catch (e) { /* leave it */ }
  }
  return { id, at, reason, size: Buffer.byteLength(text) };
}

/* The text of one backup. Throws if there is no such backup. */
async function read(saveFile, id) {
  if (!ID.test(id)) throw new Error('no such backup');
  return fs.promises.readFile(fileOf(saveFile, id), 'utf8');
}

module.exports = { KEEP, REASONS, list, make, read };
