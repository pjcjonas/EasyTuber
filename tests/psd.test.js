/* PSD import: which layers are taken, in what order, and where each one goes. The file itself is
   read by the vendored ag-psd, which is used here to make a small PSD and read it back. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const agPsd = require('../js/vendor/ag-psd.js');

function loadPT() {
  const ctx = { window: {}, navigator: { platform: 'Win32' }, structuredClone, console };
  ctx.window = ctx;
  vm.createContext(ctx);
  for (const f of ['util.js', 'defs.js', 'psd.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8'), ctx, { filename: f });
  }
  return ctx.PT;
}
const plain = (o) => JSON.parse(JSON.stringify(o));
const px = (w, h, v = 255) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4).fill(v) });
const layer = (name, extra = {}) => ({ name, left: 1, top: 2, right: 5, bottom: 6, imageData: px(4, 4), ...extra });

/* A document as Photoshop shows it, front layer first. */
function document_() {
  return {
    width: 64, height: 48,
    children: [
      { name: 'Head', opacity: 0.5, children: [
        layer('Hat'),
        { name: 'Eyes', children: [layer('open'), layer('closed', { hidden: true })] },
        layer('face'),
      ] },
      layer('scrap', { hidden: true }),
      { name: 'Hidden things', hidden: true, children: [layer('mouth open', { opacity: 0.5 })] },
      layer('Tail'),
      { name: 'empty', left: 0, top: 0, right: 0, bottom: 0 },
      layer('body'),
    ],
  };
}
const readBack = (doc) => agPsd.readPsd(agPsd.writePsdBuffer(doc), { skipCompositeImageData: true, skipThumbnail: true, useRawData: true });

test('the vendored reader reads a PSD: size, names, groups, positions', () => {
  const psd = readBack(document_());
  assert.equal(psd.width, 64);
  assert.equal(psd.height, 48);
  assert.equal(psd.children.map((l) => l.name).join(), 'Head,scrap,Hidden things,Tail,empty,body');
  const hat = psd.children[0].children[0];
  assert.equal(hat.name, 'Hat');
  assert.deepEqual([hat.left, hat.top, hat.right, hat.bottom], [1, 2, 5, 6]);
  assert.ok(hat.rawData, 'the pixels are there to unpack');          // unpacking needs a canvas: checked in the app
});

test('flatten lists the layers with pixels from the back to the front', () => {
  const PT = loadPT();
  const layers = PT.Psd.flatten(readBack(document_()));
  assert.equal(layers.map((l) => l.name).join(), 'body,Tail,mouth open,scrap,face,closed,open,Hat');   // no "empty", no groups
  const by = Object.fromEntries(layers.map((l) => [l.name, l]));
  assert.equal(by.open.path.join('/'), 'Head/Eyes');
  assert.equal(by.body.path.length, 0);
  assert.equal(by.closed.hidden, true);
  assert.equal(by.open.hidden, false);
  assert.equal(by['mouth open'].hidden, true);                        // its group is hidden
  assert.ok(Math.abs(by.Hat.opacity - 0.5) < 0.01);                   // the group's opacity
  assert.ok(Math.abs(by['mouth open'].opacity - 0.5) < 0.01);
  assert.equal(by.body.opacity, 1);
  assert.equal(PT.Psd.flatten(null).length, 0);
  assert.equal(PT.Psd.flatten({}).length, 0);
});

test('plan sends each layer to its part, or offers a new part', () => {
  const PT = loadPT();
  const layers = PT.Psd.flatten(readBack(document_()));
  const got = Object.fromEntries(PT.Psd.plan(layers).map((c, i) => [layers[i].name, plain(c)]));
  assert.deepEqual(got.body, { to: 'torso:main' });
  assert.deepEqual(got.face, { to: 'face:main' });
  assert.deepEqual(got.open, { to: 'eyes:open' });                    // "open" in the group "Eyes"
  assert.deepEqual(got.closed, { to: 'eyes:closed' });                // hidden, but it is a frame the avatar needs
  assert.deepEqual(got['mouth open'], { to: 'mouth:open' });
  assert.deepEqual(got.Hat, { to: 'new', parent: 'face' });           // in "Head": hangs from the face
  assert.deepEqual(got.Tail, { to: 'new', parent: 'torso' });
  assert.deepEqual(got.scrap, { to: 'skip' });                        // hidden and nothing claims it
});

test('plan: a name of its own is never swallowed by its group, and room runs out', () => {
  const PT = loadPT();
  const L = (name, path = [], hidden = false) => ({ name, path, hidden, opacity: 1, layer: {} });
  const to = (l, room) => plain(PT.Psd.plan([l], room)[0]);
  assert.deepEqual(to(L('Layer 12', ['Mouth'])), { to: 'mouth:closed' });
  assert.deepEqual(to(L('left upper', ['Arms'])), { to: 'armLUpper:main' });
  assert.deepEqual(to(L('hand', ['Left arm'])), { to: 'new', parent: 'armLUpper' });   // "hand" alone has no side: a part of its own, on that arm
  assert.deepEqual(to(L('glasses', ['Head', 'Extras'])), { to: 'new', parent: 'face' });
  assert.deepEqual(to(L('glasses', ['Head']), 0), { to: 'skip' });    // no room for more parts
  const three = PT.Psd.plan([L('a1x'), L('b1x'), L('c1x')], 2).map((c) => c.to);
  assert.equal(three.join(), 'new,new,skip');
  // a part the user already made takes the layer with its name
  PT.applyRig({ customParts: [{ id: 'c_hat', label: 'Hat', parent: 'face', sway: 1 }] });
  assert.deepEqual(to(L('Hat', ['Head'])), { to: 'c_hat:main' });
  assert.deepEqual(to(L('hat copy', ['Head'])), { to: 'c_hat:main' });
});

test('reorder: the document decides the stacking of what came from it', () => {
  const PT = loadPT();
  PT.applyRig({ customParts: [{ id: 'c_hat', label: 'Hat', parent: 'face', sway: 1 }, { id: 'c_tail', label: 'Tail', parent: 'torso', sway: 1 }, { id: 'c_old', label: 'Old', parent: 'torso', sway: 1 }] });
  const order = PT.DEFAULT_ORDER.slice();   // hairBack neck torso arms… face eyes mouth hairFront c_hat c_tail c_old
  // document, back to front: tail, torso, face, eyes, hat
  const got = PT.Psd.reorder(order, [['torso', 1], ['face', 4], ['eyes', 6], ['c_hat', 7], ['c_tail', 0]]);
  assert.equal(got.join(), 'hairBack,neck,c_tail,torso,armLUpper,armLLower,armRUpper,armRLower,face,eyes,c_hat,mouth,hairFront,c_old');
  assert.equal(got.length, order.length);
  // built-in parts trade places when the document says so: here the face is behind the torso
  const swapped = PT.Psd.reorder(order, [['torso', 5], ['face', 2]]);
  assert.equal(swapped.indexOf('face'), order.indexOf('torso'));
  assert.equal(swapped.indexOf('torso'), order.indexOf('face'));
  assert.equal(swapped.filter((id) => !['face', 'torso'].includes(id)).join(), order.filter((id) => !['face', 'torso'].includes(id)).join());
  // only parts of your own imported: they keep the document's order, in front of everything else
  const mine = PT.Psd.reorder(order, [['c_tail', 3], ['c_hat', 1]]);
  assert.equal(mine.slice(-3).join(), 'c_old,c_hat,c_tail');
  assert.equal(PT.Psd.reorder(order, []).join(), order.join());
});
