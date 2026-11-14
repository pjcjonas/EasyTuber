/* Custom parts: the user's own parts added to the skeleton (defs.js applyRig), how looks and
   mixes follow, filename routing, and their follow-through motion. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadPT() {
  const ctx = { window: {}, navigator: { platform: 'Win32' }, structuredClone, console };
  ctx.window = ctx;
  vm.createContext(ctx);
  for (const f of ['util.js', 'defs.js', 'avatars.js', 'animator.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8'), ctx, { filename: f });
  }
  return ctx.PT;
}
const plain = (o) => JSON.parse(JSON.stringify(o));
const BASE = ['torso', 'neck', 'face', 'eyes', 'mouth', 'hairFront', 'hairBack', 'armLUpper', 'armLLower', 'armRUpper', 'armRLower'];
const HAT = { id: 'c_hat', label: 'Party hat', parent: 'face', sway: 1 };
const TAIL = { id: 'c_tail', label: 'Tail', parent: 'torso', sway: 1.5 };
const BOW = { id: 'c_bow', label: 'Bow', parent: 'c_tail', sway: 0 };

test('only well-formed parts are kept, and a part hangs from something before it', () => {
  const PT = loadPT();
  const out = plain(PT.cleanCustomParts([
    HAT,
    { id: 'c_hat', label: 'Twice', parent: 'face' },                  // same id again
    { id: 'face', label: 'Not mine', parent: 'torso' },               // a built-in id
    { id: 'hat', label: 'No prefix' }, { id: 'c_Hat!', label: 'Bad id' }, null, 'c_x', { label: 'No id' },
    { id: 'c_a', label: '   ', parent: 'nowhere', sway: 99 },         // no name, unknown parent, too much sway
    { id: 'c_b', label: 'x'.repeat(80), parent: 'c_later', sway: -3 },   // hangs from a part that comes after it
    { id: 'c_later', label: 'Later', parent: 'c_hat', sway: 'lots' },
  ]));
  assert.deepEqual(out, [
    HAT,
    { id: 'c_a', label: 'Part', parent: 'torso', sway: 2 },
    { id: 'c_b', label: 'x'.repeat(40), parent: 'torso', sway: 0 },
    { id: 'c_later', label: 'Later', parent: 'c_hat', sway: 1 },
  ]);
  assert.deepEqual(plain(PT.cleanCustomParts(undefined)), []);
  assert.deepEqual(plain(PT.cleanCustomParts('nonsense')), []);
  const many = Array.from({ length: 60 }, (_, i) => ({ id: 'c_' + i, label: 'P' + i, parent: 'torso' }));
  assert.equal(PT.cleanCustomParts(many).length, PT.MAX_CUSTOM_PARTS);
});

test('applyRig adds the parts to the skeleton, and takes them away again', () => {
  const PT = loadPT();
  PT.applyRig({ customParts: [HAT, TAIL, BOW] });
  assert.equal(PT.PARTS.map((d) => d.id).join(), [...BASE, 'c_hat', 'c_tail', 'c_bow'].join());
  assert.equal(PT.PART.c_bow.parent, 'c_tail');
  assert.equal(PT.PART.c_hat.custom, true);
  assert.equal(PT.PART.c_hat.states.join(), 'main');
  assert.equal(PT.PART.c_tail.sway, 1.5);
  // parents always come before children, which is what the pose and the motion rely on
  PT.PARTS.forEach((d, i) => assert.ok(!d.parent || PT.PARTS.findIndex((x) => x.id === d.parent) < i, d.id));
  assert.equal(PT.DEFAULT_ORDER.slice(-3).join(), 'c_hat,c_tail,c_bow');   // in front of the built-in parts
  assert.equal(PT.LAYOUT.c_hat.x, PT.LAYOUT.face.x);                        // starts at its parent's joint
  assert.equal(PT.LAYOUT.c_bow.y, PT.LAYOUT.torso.y);
  const part = PT.defaultPart('c_hat');
  assert.equal(part.x, PT.LAYOUT.face.x);
  assert.deepEqual(plain(part.images), {});
  assert.deepEqual(plain(PT.customParts()), [HAT, TAIL, BOW]);

  PT.applyRig(null);
  assert.equal(PT.PARTS.map((d) => d.id).join(), BASE.join());
  assert.equal(PT.PART.c_hat, undefined);
  assert.equal(PT.LAYOUT.c_hat, undefined);
  assert.equal(PT.DEFAULT_ORDER.length, BASE.length);
  assert.equal(PT.PART.armLUpper.label, 'Upper arm');
  assert.equal(PT.partName(PT.PART.armLUpper), 'Left arm: Upper arm');
  assert.equal(PT.partName(PT.PART.face), 'Face');
});

test('a project brings its own parts; an older file has none', () => {
  const PT = loadPT();
  const p = PT.normalizeProject({
    customParts: [HAT, { id: 'bad' }],
    parts: { face: { images: { main: 'data:face' } }, c_hat: { images: { main: 'data:hat' }, x: 123, y: 45 }, c_gone: { images: { main: 'data:gone' } } },
    order: ['c_hat', 'face', 'c_gone', 'c_hat'],
  });
  assert.deepEqual(plain(p.customParts), [HAT]);
  assert.equal(p.parts.c_hat.images.main, 'data:hat');
  assert.equal(p.parts.c_hat.x, 123);
  assert.equal(p.parts.c_hat.scale, 1);                                // the rest filled in
  assert.equal(p.parts.c_gone, undefined);                             // a part that is not in the list
  assert.equal(p.order[0], 'c_hat');                                   // kept where the user put it, once
  assert.equal(p.order.filter((id) => id === 'c_hat').length, 1);
  assert.equal(p.order.length, BASE.length + 1);
  assert.ok(!p.order.includes('c_gone'));

  // a new project made while those parts exist has them too
  assert.deepEqual(plain(PT.defaultProject().customParts), [HAT]);
  assert.ok(PT.defaultProject().parts.c_hat);

  // opening a file from before custom parts takes the skeleton back to the built-in one
  const old = PT.normalizeProject({ parts: { face: { images: { main: 'data:face' } } } });
  assert.deepEqual(plain(old.customParts), []);
  assert.equal(Object.keys(old.parts).join(), BASE.join());
  assert.equal(PT.PARTS.length, BASE.length);
  assert.deepEqual(plain(PT.normalizeProject(null).customParts), []);
});

test('normalising one look leaves the skeleton alone', () => {
  const PT = loadPT();
  PT.applyRig({ customParts: [HAT] });
  const look = PT.normalizeProject({ parts: { c_hat: { images: { main: 'data:hat' } } }, order: ['c_hat'] }, true);
  assert.equal(PT.PART.c_hat.label, 'Party hat');                      // still there, though the look lists no parts
  assert.equal(look.parts.c_hat.images.main, 'data:hat');
  assert.deepEqual(plain(look.customParts), [HAT]);
});

test('syncLook makes a look fit: new parts at their parent, gone parts dropped', () => {
  const PT = loadPT();
  const look = PT.Avatars.takeLook(PT.normalizeProject({}));
  look.parts.face.x = 777; look.parts.face.y = 333;
  PT.applyRig({ customParts: [HAT, TAIL] });
  PT.syncLook(look);
  assert.equal(look.parts.c_hat.x, 777);                               // at the face's joint in THIS look
  assert.equal(look.parts.c_hat.y, 333);
  assert.equal(look.order.slice(-2).join(), 'c_hat,c_tail');
  look.parts.c_hat.images.main = 'data:hat';
  look.order = ['c_hat', ...look.order.filter((id) => id !== 'c_hat')];
  PT.syncLook(look);                                                   // again: nothing moves
  assert.equal(look.parts.c_hat.images.main, 'data:hat');
  assert.equal(look.order[0], 'c_hat');

  PT.applyRig({ customParts: [TAIL] });                                // the hat was deleted
  PT.syncLook(look);
  assert.equal(look.parts.c_hat, undefined);
  assert.ok(!look.order.includes('c_hat'));
  assert.ok(look.parts.c_tail);
  assert.equal(look.order.length, BASE.length + 1);
  // things that are not looks are left alone
  assert.equal(PT.syncLook(null), null);
  assert.deepEqual(PT.syncLook({ nope: 1 }), { nope: 1 });
});

test('switching looks keeps each avatar\'s own image for a custom part', () => {
  const PT = loadPT();
  const project = PT.normalizeProject({ customParts: [HAT] });
  project.parts.c_hat.images.main = 'data:red-hat';
  const mine = plain(PT.Avatars.takeLook(project));
  const theirs = plain(PT.Avatars.blankLook());
  theirs.parts.c_hat.images.main = 'data:blue-hat';
  PT.Avatars.putLook(project, theirs);
  assert.equal(project.parts.c_hat.images.main, 'data:blue-hat');
  assert.equal(PT.PART.c_hat.label, 'Party hat');
  PT.Avatars.putLook(project, mine);
  assert.equal(project.parts.c_hat.images.main, 'data:red-hat');
  // a look saved before the hat existed gets an empty hat
  const before = plain(mine); delete before.parts.c_hat; before.order = before.order.filter((id) => id !== 'c_hat');
  PT.Avatars.putLook(project, before);
  assert.deepEqual(plain(project.parts.c_hat.images), {});
  assert.ok(project.order.includes('c_hat'));
});

test('a random mix takes each custom part from an avatar that has it', () => {
  const PT = loadPT();
  PT.applyRig({ customParts: [HAT, TAIL] });
  assert.equal(PT.Avatars.MIX_GROUPS.length, 11);
  assert.equal(PT.Avatars.MIX_GROUPS.slice(-2).map((g) => g.join()).join('|'), 'c_hat|c_tail');
  const a = plain(PT.Avatars.blankLook()), b = plain(PT.Avatars.blankLook()), c = plain(PT.Avatars.blankLook());
  a.parts.c_hat.images.main = 'data:hat-a';
  delete c.parts.c_hat; delete c.parts.c_tail;                         // from before the parts existed
  for (let i = 0; i < 30; i++) {
    const { look } = PT.Avatars.mix([a, b, c], Math.random, a);
    assert.equal(look.parts.c_hat.images.main, 'data:hat-a');         // only a has a hat
    assert.ok(look.parts.c_tail);                                      // nobody has a tail: still a valid part
    assert.equal(look.parts.c_tail.scale, 1);
  }
  PT.applyRig(null);
  assert.equal(PT.Avatars.MIX_GROUPS.length, 9);
});

test('dropped files go to a custom part by its name', () => {
  const PT = loadPT();
  PT.applyRig({ customParts: [HAT, { id: 'c_hand', label: 'Left hand', parent: 'armLLower', sway: 0 }, { id: 'c_h', label: 'Hat', parent: 'face', sway: 1 }, { id: 'c_x', label: '!', parent: 'face', sway: 1 }] });
  assert.equal(PT.routeFilename('party-hat.png').part, 'c_hat');       // the longer name wins over "Hat"
  assert.equal(PT.routeFilename('My_Hat_v2.PNG').part, 'c_h');
  assert.equal(PT.routeFilename('left hand.png').part, 'c_hand');      // not the built-in forearm
  assert.equal(PT.routeFilename('left_forearm.png').part, 'armLLower');
  assert.equal(PT.routeFilename('eyes_closed.png').state, 'closed');
  assert.equal(PT.routeFilename('whatever.png').part, null);           // "hat" inside another word is not the hat
  assert.equal(PT.routeFilename('partyhat.png').part, 'c_hat');
  PT.applyRig(null);
  assert.equal(PT.routeFilename('party-hat.png').part, null);
  assert.equal(PT.routeFilename('left hand.png').part, 'armLLower');
});

test('a custom part swings behind its parent, unless its sway is 0', () => {
  const PT = loadPT();
  const stiff = { id: 'c_stiff', label: 'Glasses', parent: 'face', sway: 0 };
  PT.applyRig({ customParts: [HAT, stiff, { id: 'c_tip', label: 'Tip', parent: 'c_hat', sway: 2 }] });
  const p = PT.defaultProject();
  const anim = new PT.Animator();
  let hat = 0, tip = 0;
  for (let i = 0; i < 600; i++) {
    const level = i % 40 < 20 ? 1 : 0;                                 // talking in bursts: the head tilts and bobs
    const { deltas } = anim.update(1 / 60, level, p.motion, p.mic);
    for (const id of ['c_hat', 'c_stiff', 'c_tip']) {
      const d = deltas[id];
      assert.ok(d && [d.ox, d.oy, d.rot, d.sx, d.sy].every(Number.isFinite), id);
      assert.ok(Math.abs(d.rot) <= 12, id);
    }
    assert.equal(deltas.c_stiff.rot, 0);
    hat = Math.max(hat, Math.abs(deltas.c_hat.rot));
    tip = Math.max(tip, Math.abs(deltas.c_tip.rot));
    for (const id of BASE) assert.ok(deltas[id], id);                  // the built-in motion is all still there
  }
  assert.ok(hat > 0.05, 'the hat moved: ' + hat);
  assert.ok(tip > 0.05, 'the part on the hat moved: ' + tip);
  // quiet for a while: it settles
  let last;
  const quiet = { ...p.motion, idleSway: 0, breathAmount: 0, armSway: 0, hairPhysics: 0 };
  for (let i = 0; i < 900; i++) last = anim.update(1 / 60, 0, quiet, p.mic).deltas;
  assert.ok(Math.abs(last.c_hat.rot) < 0.05, 'settled: ' + last.c_hat.rot);

  // with the parts gone the animator gives none
  PT.applyRig(null);
  assert.equal(anim.update(1 / 60, 0, p.motion, p.mic).deltas.c_hat, undefined);
});
