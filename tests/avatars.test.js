/* The browser-side avatar logic, loaded into a sandbox the way the page loads it. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadPT() {
  const ctx = { window: {}, navigator: { platform: 'Win32' }, structuredClone, console };
  ctx.window = ctx;
  vm.createContext(ctx);
  for (const f of ['util.js', 'defs.js', 'avatars.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8'), ctx, { filename: f });
  }
  return ctx.PT;
}
const PT = loadPT();
const plain = (o) => JSON.parse(JSON.stringify(o));

test('a file from before avatars gets one avatar holding its look', () => {
  const old = plain(PT.defaultProject());
  delete old.avatars; delete old.activeAvatar; delete old.hotkeys; delete old.switchFx;
  old.name = 'Papa';
  old.parts.face.images.main = 'data:face';
  const p = PT.normalizeProject(old);
  assert.equal(p.avatars.length, 1);
  assert.equal(p.avatars[0].name, 'Papa');
  assert.equal(p.avatars[0].look, null);
  assert.equal(p.activeAvatar, p.avatars[0].id);
  assert.equal(p.parts.face.images.main, 'data:face');
  assert.deepEqual(plain(p.hotkeys), { next: '', random: '' });
  assert.equal(p.switchFx, true);
});

test('normalize keeps the library and never stores the active look twice', () => {
  const p = PT.normalizeProject({
    parts: {},
    avatars: [
      { id: 'x', name: 'One', hotkey: 'Ctrl+Alt+1', look: { parts: {} } },   // active: its stored look is dropped
      { id: 'y', name: 'Two', hotkey: '', look: { parts: { face: { images: { main: 'data:two' } } } } },
      { id: 'y', name: 'Duplicate id', look: null },
      { name: 'No id' },
    ],
    activeAvatar: 'x',
  });
  assert.deepEqual(p.avatars.map((a) => a.id), ['x', 'y']);
  assert.equal(p.avatars[0].look, null);
  assert.equal(p.avatars[1].look.parts.face.images.main, 'data:two');
  assert.equal(p.avatars[0].hotkey, 'Ctrl+Alt+1');
});

test('an unknown active avatar falls back to the one without a stored look', () => {
  const p = PT.normalizeProject({ avatars: [{ id: 'a', name: 'A', look: { parts: {} } }, { id: 'b', name: 'B', look: null }], activeAvatar: 'gone' });
  assert.equal(p.activeAvatar, 'b');
  const r = PT.normalizeProject({ avatars: [{ id: 'a', name: 'A', look: { parts: {} } }, { id: 'b', name: 'B', look: { parts: {} } }], activeAvatar: 'random' });
  assert.equal(r.activeAvatar, 'random');
  assert.ok(r.avatars.every((a) => a.look));
  // "random" while one avatar has no stored look: that avatar's look is the one on screen, keep it
  const m = PT.normalizeProject({ avatars: [{ id: 'a', name: 'A', look: { parts: {} } }, { id: 'b', name: 'B', look: null }], activeAvatar: 'random' });
  assert.equal(m.activeAvatar, 'b');
});

function lookWith(tag) {
  const look = PT.Avatars.blankLook();
  for (const id of Object.keys(look.parts)) {
    look.parts[id].images = { main: `data:${tag}-${id}` };
    look.parts[id].x = tag.charCodeAt(0);
  }
  return look;
}

test('a random mix takes each group from one avatar and keeps both arm pieces together', () => {
  const looks = [lookWith('A'), lookWith('B'), lookWith('C')];
  let seq = 0;
  const rng = () => [0.1, 0.5, 0.9][seq++ % 3];   // picks A, B, C, A, B, C, ...
  const { look, picks } = PT.Avatars.mix(looks, rng, looks[0]);
  assert.equal(picks.length, PT.Avatars.MIX_GROUPS.length);
  PT.Avatars.MIX_GROUPS.forEach((group, i) => {
    const tag = 'ABC'[picks[i]];
    for (const id of group) assert.equal(look.parts[id].images.main, `data:${tag}-${id}`, id);
  });
  assert.equal(look.parts.armLUpper.images.main.split('-')[0], look.parts.armLLower.images.main.split('-')[0]);
  // copies: changing the mix leaves the avatars alone
  look.parts.face.x = 999;
  assert.notEqual(looks[picks[2]].parts.face.x, 999);
});

test('a random mix only picks avatars that have art for that part', () => {
  const a = lookWith('A');
  const b = PT.Avatars.blankLook();           // no art at all
  b.parts.eyes.images = { open: 'data:B-eyes' };
  for (let i = 0; i < 20; i++) {
    const { look } = PT.Avatars.mix([a, b], Math.random, a);
    assert.equal(look.parts.face.images.main, 'data:A-face');   // only A has a face
  }
});

test('key presses become accelerators, and bare letters are refused', () => {
  const ev = (o) => ({ ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, key: '', code: '', ...o });
  const acc = (o, mac) => PT.Avatars.acceleratorFromEvent(ev(o), mac);
  assert.deepEqual(plain(acc({ ctrlKey: true, altKey: true, code: 'Digit1', key: '1' })), { accelerator: 'Ctrl+Alt+1' });
  assert.deepEqual(plain(acc({ code: 'F9', key: 'F9' })), { accelerator: 'F9' });
  assert.deepEqual(plain(acc({ code: 'Numpad3', key: '3' })), { accelerator: 'num3' });
  assert.deepEqual(plain(acc({ metaKey: true, code: 'KeyK', key: 'k' }, true)), { accelerator: 'Cmd+K' });
  assert.deepEqual(plain(acc({ metaKey: true, code: 'KeyK', key: 'k' }, false)), { accelerator: 'Super+K' });
  assert.ok(acc({ code: 'KeyA', key: 'a' }).error);
  assert.equal(acc({ ctrlKey: true, code: 'ControlLeft', key: 'Control' }), null);   // still holding modifiers
  assert.equal(PT.Avatars.prettyKey('Ctrl+Alt+num3'), 'Ctrl + Alt + Num 3');
});

test('every accelerator the editor can produce passes the server check', () => {
  const { validBinding } = require('../electron/server');
  const codes = ['KeyQ', 'Digit7', 'Numpad0', 'NumpadAdd', 'F1', 'F12', 'ArrowUp', 'Space', 'Minus', 'Backslash', 'Backquote', 'PageDown', 'Delete'];
  for (const code of codes) {
    for (const mods of [{ ctrlKey: true }, { altKey: true, shiftKey: true }, { metaKey: true }]) {
      const r = PT.Avatars.acceleratorFromEvent({ ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, key: 'x', code, ...mods }, false);
      assert.ok(r && r.accelerator, code);
      assert.ok(validBinding({ accelerator: r.accelerator, action: 'next' }), r.accelerator);
    }
  }
});
