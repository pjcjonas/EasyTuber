/* The stage effects (dim when quiet, outline, shadow): which ones apply this frame. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadPT() {
  const ctx = { window: {}, navigator: { platform: 'Win32' }, structuredClone, console };
  ctx.window = ctx;
  vm.createContext(ctx);
  for (const f of ['util.js', 'defs.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8'), ctx, { filename: f });
  return ctx.PT;
}
const PT = loadPT();
const plain = (o) => JSON.parse(JSON.stringify(o));

test('a new avatar has no stage effects', () => {
  const p = PT.defaultProject();
  assert.equal(p.stage.dimSilent, 0);
  assert.equal(p.stage.outlineWidth, 0);
  assert.equal(p.stage.shadow, 0);
  assert.equal(PT.stageFx(p.stage, 0, false), null);
  assert.equal(PT.stageFx(p.stage, 1, false), null);
  // a file from before the effects gets the defaults
  const old = PT.normalizeProject({ stage: { bg: 'green' } });
  assert.equal(old.stage.bg, 'green');
  assert.equal(old.stage.outlineColor, '#ffffff');
  assert.equal(PT.stageFx(old.stage, 0, false), null);
});

test('dim when quiet: dark while silent, full brightness as soon as you talk', () => {
  const stage = { dimSilent: 60 };
  assert.equal(PT.stageFx(stage, 0, false).dim, 0.6);
  assert.ok(Math.abs(PT.stageFx(stage, 0.15, false).dim - 0.3) < 1e-9);   // fading back in
  assert.equal(PT.stageFx(stage, 0.3, false), null);                 // talking, however softly: nothing to draw
  assert.equal(PT.stageFx(stage, 1, false), null);
  assert.equal(PT.stageFx({ dimSilent: 100 }, 0, false).dim, 1);
  assert.equal(PT.stageFx({ dimSilent: 500 }, 0, false).dim, 1);     // out of range values are held in
  assert.equal(PT.stageFx({ dimSilent: -5 }, 0, false), null);
  assert.equal(PT.stageFx({ dimSilent: 'lots' }, 0, false), null);
  assert.equal(PT.stageFx(stage, NaN, false).dim, 0.6);
});

test('outline and shadow do not depend on talking', () => {
  for (const vol of [0, 0.5, 1]) {
    assert.deepEqual(plain(PT.stageFx({ outlineWidth: 6, outlineColor: '#ff00aa', shadow: 50 }, vol, false)), { dim: 0, outline: 6, outlineColor: '#ff00aa', shadow: 0.5 });
  }
  assert.equal(PT.stageFx({ outlineWidth: 99 }, 0, false).outline, 20);
  assert.equal(PT.stageFx({ outlineWidth: 3, outlineColor: 'red; drop table' }, 0, false).outlineColor, '#ffffff');   // only a plain colour is used
  assert.equal(PT.stageFx({ shadow: 250 }, 0, false).shadow, 1);
});

test('nothing is drawn differently while editing', () => {
  assert.equal(PT.stageFx({ dimSilent: 80, outlineWidth: 8, shadow: 80 }, 0, true), null);
  assert.equal(PT.stageFx(null, 0, false), null);
});
