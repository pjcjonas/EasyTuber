/* The parts library: what is kept in the project, how a part's pictures fit another part, and
   that the library's pictures are stored and saved like an avatar's. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadPT() {
  const ctx = { window: {}, navigator: { platform: 'Win32' }, structuredClone, console };
  ctx.window = ctx;
  vm.createContext(ctx);
  for (const f of ['util.js', 'defs.js', 'library.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8'), ctx, { filename: f });
  return ctx.PT;
}
const plain = (o) => JSON.parse(JSON.stringify(o));
const A = 'img:' + 'a'.repeat(64), B = 'img:' + 'b'.repeat(64), C = 'data:image/png;base64,AAAA';

test('the library is kept with the project, cleaned', () => {
  const PT = loadPT();
  const p = PT.normalizeProject({
    library: [
      { id: 'l1', name: ' Red hat ', part: 'face', images: { main: A, junk: 'not a picture', 'main@happy': B }, place: { x: 1, y: 2, rot: 3, scale: 1, px: 4, py: 5, flip: 1 }, at: 7 },
      { id: 'l1', name: 'twice', part: 'face', images: { main: A } },             // same id again
      { id: 'bad id', name: 'x', images: { main: A } }, null, 'l9',
      { id: 'l2', name: '', part: 'nowhere', images: { open: C }, place: { x: 'left' } },
      { id: 'l3', name: 'no pictures', part: 'eyes', images: { open: 'http://example.com/x.png' } },
    ],
  });
  assert.deepEqual(plain(p.library), [
    { id: 'l1', kind: 'part', name: 'Red hat', part: 'face', images: { main: A, 'main@happy': B }, adj: {}, place: { x: 1, y: 2, rot: 3, scale: 1, px: 4, py: 5, flip: true }, at: 7 },
    { id: 'l2', kind: 'part', name: 'Part', part: '', images: { open: C }, adj: {}, place: null, at: 0 },   // unknown part: for any part
  ]);
  assert.deepEqual(plain(PT.normalizeProject({}).library), []);          // older files have none
  assert.deepEqual(plain(PT.defaultProject().library), []);
  const many = Array.from({ length: 600 }, (_, i) => ({ id: 'l' + i, images: { main: A } }));
  assert.equal(PT.normalizeProject({ library: many }).library.length, 500);
  // a look (one avatar) never carries the library
  assert.ok(!PT.LOOK_KEYS.includes('library'));
});

test('a part\'s pictures are fitted to the part they are put on', () => {
  const PT = loadPT();
  const L = PT.Library;
  // the same kind of part: every state comes along, with its expression pictures
  assert.deepEqual(plain(L.fitImages({ open: A, closed: B, 'open@happy': C }, 'eyes')), { open: A, closed: B, 'open@happy': C });
  // eyes onto a one-picture part: the open eyes stand for it
  assert.deepEqual(plain(L.fitImages({ closed: B, open: A }, 'face')), { main: A });
  // one picture onto the eyes: it becomes the open eyes
  assert.deepEqual(plain(L.fitImages({ main: A }, 'eyes')), { open: A });
  // the mouth's vowel shapes are kept on a mouth
  assert.deepEqual(plain(L.fitImages({ closed: A, a: B }, 'mouth')), { closed: A, a: B });
  assert.deepEqual(plain(L.fitImages({}, 'face')), {});
  assert.deepEqual(plain(L.fitImages({ main: A }, 'no-such-part')), {});
  assert.deepEqual(plain(L.fitImages({ main: 'javascript:alert(1)' }, 'face')), {});   // only pictures
  // the cover picture: the first state that has one
  assert.equal(L.cover({ closed: B, open: A }, 'eyes'), A);
  assert.equal(L.cover({ half: B }, 'eyes'), B);
  assert.equal(L.cover({ 'main@happy': B, main: A }, 'face'), A);
  assert.equal(L.cover({}, 'face'), null);
});

test('the library\'s pictures are stored as files and inlined by Save file, like an avatar\'s', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'storage.js'), 'utf8');
  const ctx = { window: {}, navigator: {}, console, indexedDB: undefined, location: { protocol: 'http:', port: '8777', search: '' }, fetch: () => Promise.reject(new Error('offline')) };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'util.js'), 'utf8'), ctx);
  vm.runInContext(src, ctx);
  const slots = ctx.PT.Storage.pictureSlots({ parts: { face: { images: { main: A } } }, avatars: [], library: [{ id: 'l1', images: { main: B, open: C } }] });
  assert.equal(slots.map(([o, k]) => o[k]).join(), [A, B, C].join());
});

test('accessories are library entries of their own kind, for no part in particular', () => {
  const PT = loadPT();
  const p = PT.normalizeProject({ library: [
    { id: 'l1', kind: 'accessory', name: 'Bow', part: 'face', images: { main: A } },
    { id: 'l2', kind: 'weird', name: 'Eyes', part: 'eyes', images: { open: B } },
  ] });
  assert.deepEqual(p.library.map((x) => x.kind + ':' + x.part).join(), 'accessory:,part:eyes');   // an accessory is for any part
  PT.App = { project: p };
  assert.equal(PT.Library.parts().map((x) => x.name).join(), 'Eyes');                          // not in the parts library list
  assert.equal(PT.Library.for('eyes', true).map((x) => x.name).join(), 'Eyes');               // nor in Swap part's library tiles
});

test('uploaded pictures: one option each, except frames of one item', () => {
  const PT = loadPT();
  const g = (names, part) => plain(PT.Library.groupUploads(names, part)).map((x) => `${x.part}:${x.name}=${x.files.map((f) => names[f.index].replace('.png', '') + '>' + f.state).join('+')}`);
  // several pictures for a one-picture part: each its own option (this used to keep only the last)
  assert.deepEqual(g(['red cap.png', 'blue cap.png', 'crown.png'], 'face'), ['face:red cap=red cap>main', 'face:blue cap=blue cap>main', 'face:crown=crown>main']);
  // eyes: frames of one item go together, different items stay apart
  assert.deepEqual(g(['cute_eyes_open.png', 'cute_eyes_closed.png', 'angry_eyes_open.png', 'angry_eyes_closed.png', 'angry_eyes_half.png'], 'eyes'), [
    'eyes:cute eyes=cute_eyes_open>open+cute_eyes_closed>closed',
    'eyes:angry eyes=angry_eyes_open>open+angry_eyes_closed>closed+angry_eyes_half>half',
  ]);
  // names that say nothing about frames: one option each, as the open eyes
  assert.deepEqual(g(['red.png', 'green.png'], 'eyes'), ['eyes:red=red>open', 'eyes:green=green>open']);
  // vowel mouth shapes join their mouth
  assert.deepEqual(g(['smile_mouth_closed.png', 'smile_mouth_open.png', 'smile_mouth_ah.png'], 'mouth'), ['mouth:smile mouth=smile_mouth_closed>closed+smile_mouth_open>open+smile_mouth_ah>a']);
  // no part given: sorted by name, the same rules
  assert.deepEqual(g(['eyes_open.png', 'eyes_closed.png', 'torso.png', 'body.png', 'sticker.png']), [
    'eyes:eyes=eyes_open>open+eyes_closed>closed', 'torso:torso=torso>main', 'torso:body=body>main', ':sticker=sticker>main',
  ]);
  // two files claiming the same frame of one item: the second takes a free frame instead of overwriting
  assert.deepEqual(g(['eyes_open.png', 'eyes_open copy.png'], 'eyes').length, 2);
});
