/* Expressions: the list in the project, which image a part shows in one, and the hotkey and
   Streamer.bot routes that switch them. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const vm = require('node:vm');
const { start, validBinding } = require('../electron/server');

const ROOT = path.join(__dirname, '..');
function loadPT() {
  const ctx = { window: {}, navigator: { platform: 'Win32' }, structuredClone, console };
  ctx.window = ctx;
  vm.createContext(ctx);
  for (const f of ['util.js', 'defs.js', 'assets.js', 'avatars.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8'), ctx, { filename: f });
  }
  return ctx.PT;
}
const plain = (o) => JSON.parse(JSON.stringify(o));

test('the expression list is cleaned, and the one on screen must be in it', () => {
  const PT = loadPT();
  const p = PT.normalizeProject({
    expressions: [
      { id: 'happy', name: ' Happy ', hotkey: 'F5' },
      { id: 'happy', name: 'Twice' }, { id: 'off', name: 'Reserved' }, { id: 'Bad Id', name: 'x' }, { id: '', name: 'x' }, null, 'angry',
      { id: 'very-angry_2', name: '', hotkey: 7 },
    ],
    expression: 'happy',
  });
  assert.deepEqual(plain(p.expressions), [{ id: 'happy', name: 'Happy', hotkey: 'F5' }, { id: 'very-angry_2', name: 'very-angry_2', hotkey: '' }]);
  assert.equal(p.expression, 'happy');
  assert.equal(PT.normalizeProject({ expressions: [{ id: 'happy', name: 'Happy' }], expression: 'gone' }).expression, '');
  const old = PT.normalizeProject({ parts: {} });                     // a file from before expressions
  assert.deepEqual(plain(old.expressions), []);
  assert.equal(old.expression, '');
  const many = Array.from({ length: 40 }, (_, i) => ({ id: 'e' + i, name: 'E' + i }));
  assert.equal(PT.normalizeProject({ expressions: many }).expressions.length, PT.MAX_EXPRESSIONS);
  // a part's images for an expression come through untouched
  const kept = PT.normalizeProject({ parts: { eyes: { images: { open: 'data:a', 'open@happy': 'data:b' } } } });
  assert.equal(kept.parts.eyes.images['open@happy'], 'data:b');
});

test('an expression gets an id from its name', () => {
  const PT = loadPT();
  assert.equal(PT.expressionId('Very Happy!'), 'very-happy');
  assert.equal(PT.expressionId('Happy', ['happy']), 'happy-2');
  assert.equal(PT.expressionId('Happy', ['happy', 'happy-2']), 'happy-3');
  assert.equal(PT.expressionId('😀'), 'expression');
  assert.equal(PT.expressionId('Off'), 'off-1');                      // "off" means back to normal in an address
  assert.equal(PT.expressionId('x'.repeat(80)).length, 32);
  assert.equal(PT.imageKey('open', 'happy'), 'open@happy');
  assert.equal(PT.imageKey('main', ''), 'main');
});

test('a part shows its image for the expression, and its normal one when it has none', () => {
  const PT = loadPT();
  const A = PT.Assets, e = (name) => ({ name });
  A.user = {
    eyes: { open: e('open'), closed: e('closed'), 'open@happy': e('happy-open'), 'open@sad': e('sad-open'), 'closed@sad': e('sad-closed') },
    mouth: { closed: e('m-closed'), open: e('m-open') },
    face: { main: e('face'), 'main@happy': e('happy-face') },
    hairFront: { 'main@happy': e('flower') },                         // only there in the expression
  };
  const got = (...args) => { const r = A.resolve(...args); return r && [r.entry.name, r.state, r.squash]; };

  // normal: exactly as before
  assert.deepEqual(got('eyes', 'open', false), ['open', 'open', 1]);
  assert.deepEqual(got('eyes', 'closed', false, ''), ['closed', 'closed', 1]);
  assert.deepEqual(got('face', 'main', false), ['face', 'main', 1]);
  assert.equal(got('hairFront', 'main', false), null);

  // happy: its own images first
  assert.deepEqual(got('eyes', 'open', false, 'happy'), ['happy-open', 'open@happy', 1]);
  assert.deepEqual(got('face', 'main', false, 'happy'), ['happy-face', 'main@happy', 1]);
  assert.deepEqual(got('hairFront', 'main', false, 'happy'), ['flower', 'main@happy', 1]);
  // blinking goes on inside the expression: with one happy eye image, it is squashed like a lone open eye
  assert.deepEqual(got('eyes', 'closed', false, 'happy'), ['happy-open', 'open@happy', 0.1]);
  assert.deepEqual(got('eyes', 'half', false, 'happy'), ['happy-open', 'open@happy', 0.5]);
  // sad has both frames
  assert.deepEqual(got('eyes', 'closed', false, 'sad'), ['sad-closed', 'closed@sad', 1]);
  // a part with nothing for the expression talks on with its normal images
  assert.deepEqual(got('mouth', 'open', false, 'happy'), ['m-open', 'open', 1]);
  assert.deepEqual(got('face', 'main', false, 'sad'), ['face', 'main', 1]);
  // an expression nobody has images for changes nothing
  assert.deepEqual(got('eyes', 'open', false, 'nope'), ['open', 'open', 1]);

  // the image that defines a part's frame: a normal one, else the first expression image
  assert.equal(A.primary('eyes', false).name, 'open');
  assert.equal(A.primary('hairFront', false).name, 'flower');
  assert.equal(A.primary('torso', false), null);

  // placeholders have no expressions
  A.placeholders = { torso: { main: e('ph') } };
  assert.deepEqual(got('torso', 'main', true, 'happy'), ['ph', 'main', 1]);
  assert.equal(got('torso', 'main', false, 'happy'), null);
});

test('an expression can have a global hotkey', () => {
  const PT = loadPT();
  assert.equal(validBinding({ accelerator: 'Ctrl+Alt+H', action: 'expression:happy' }), true);
  assert.equal(validBinding({ accelerator: 'F9', action: 'expression:very-angry_2' }), true);
  assert.equal(validBinding({ accelerator: 'F9', action: 'expression:' }), false);
  assert.equal(validBinding({ accelerator: 'F9', action: 'expression:a b' }), false);
  // the editor's list of keys to register includes them, and a key can only be used once
  const project = PT.normalizeProject({ expressions: [{ id: 'happy', name: 'Happy', hotkey: 'F9' }, { id: 'sad', name: 'Sad', hotkey: '' }] });
  PT.App = { project };
  assert.deepEqual(plain(PT.Avatars.bindings()), [{ accelerator: 'F9', action: 'expression:happy' }]);
  assert.equal(PT.Avatars.keyInUse('F9', 'expression:sad'), true);
  assert.equal(PT.Avatars.keyInUse('F9', 'expression:happy'), false);   // its own key
  assert.equal(PT.Avatars.keyInUse('F8', 'expression:sad'), false);
});
