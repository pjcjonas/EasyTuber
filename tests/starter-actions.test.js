/* The built-in "High energy" pack: every action loads, runs its whole length with sensible poses,
   draws without errors on either side of the stage, honours its Strength and Effects settings,
   and ends. Victory pose is held: it stays on until it is released. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const PACK = {
  hop: { label: 'Hop', duration: 900 },
  cheer: { label: 'Cheer', duration: 2400 },
  dance: { label: 'Dance', duration: 4000 },
  spin: { label: 'Spin', duration: 1400 },
  headbang: { label: 'Headbang', duration: 2400 },
  surprised: { label: 'Surprised', duration: 1200 },
  shiver: { label: 'Shiver', duration: 2500 },
  dizzy: { label: 'Dizzy', duration: 3000 },
  wave: { label: 'Wave', duration: 2200 },
  victory: { label: 'Victory pose', hold: true },
};
const TIMED = Object.keys(PACK).filter((id) => !PACK[id].hold);

function loadPT() {
  const ctx = { window: {}, navigator: { platform: 'Win32' }, structuredClone, console, performance };
  ctx.window = ctx;
  vm.createContext(ctx);
  const files = ['js/util.js', 'js/defs.js', 'js/actions.js', ...Object.keys(PACK).map((id) => `js/actions/${id}.js`)];
  for (const f of files) vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
  return ctx.PT;
}

// a canvas context that counts what is drawn and checks every number it is given
function fakeContext() {
  const calls = {};
  const g = new Proxy({}, {
    get(target, k) {
      if (k in target) return target[k];
      return (...args) => {
        for (const v of args) if (typeof v === 'number') assert.ok(Number.isFinite(v), `${String(k)} got ${v}`);
        calls[k] = (calls[k] || 0) + 1;
      };
    },
    set(target, k, v) {
      if (typeof v === 'number') assert.ok(Number.isFinite(v), `${String(k)} = ${v}`);
      target[k] = v;
      return true;
    },
  });
  return { g, calls };
}

/* every part is a 100 x 100 image with 10 px margins; the head at faceX, the arms hanging beside it */
function fakePose(PT, faceX) {
  PT.Assets = { primary: () => ({ w: 100, h: 100, bbox: { x: 10, y: 10, w: 80, h: 80 } }), hasUser: () => true };
  const at = (x, y) => ({ world: [1, 0, 0, 1, x, y] });
  const pose = {};
  for (const d of PT.PARTS) pose[d.id] = at(faceX - 50, 300);
  for (const [side, dx] of [['R', 150], ['L', -150]]) {
    pose['arm' + side + 'Upper'] = at(faceX + dx - 50, 420);
    pose['arm' + side + 'Lower'] = at(faceX + dx - 50, 520);
  }
  PT.Actions.setPose(pose, { view: () => [1, 0, 0, 1, 0, 0] });
}

function projectWith(PT, id, settings) {
  const project = PT.normalizeProject({});
  if (settings) project.actions = { [id]: { settings } };
  return project;
}

/* play one action from 0 ms in 50 ms steps until `until`, checking every frame */
function run(PT, id, project, until) {
  const { g, calls } = fakeContext();
  const R = { ctx: g, view: () => [1, 0, 0, 1, 0, 0] };
  assert.equal(PT.Actions.play(id, { seed: 1234 }, project, 0), true);
  const frames = [];
  for (let t = 0; t <= until; t += 50) {
    const f = PT.Actions.update(t, project);
    if (!f) { frames.push({ t, over: true }); continue; }
    PT.Actions.draw('behind', R);
    PT.Actions.draw('front', R);
    PT.Actions.drawOrder(project.order);
    for (const [part, d] of Object.entries(f.deltas)) {
      assert.ok(PT.PART[part], `${id}: unknown part ${part}`);
      for (const v of [d.ox, d.oy, d.rot, d.sx, d.sy]) assert.ok(Number.isFinite(v), `${id}: ${part} at ${t}`);
      assert.ok(Math.abs(d.sx) > 0.01 && Math.abs(d.sy) > 0.01, `${id}: ${part} squashed flat at ${t}`);
    }
    frames.push({ t, deltas: f.deltas, states: f.states });
  }
  return { frames, calls };
}

const drawn = (calls) => ['fill', 'stroke', 'fillText', 'strokeText'].reduce((n, k) => n + (calls[k] || 0), 0);

test('the whole pack is built in, with labels, lengths and settings', () => {
  const PT = loadPT();
  assert.deepEqual([...PT.Actions.list().map((d) => d.id)].sort(), Object.keys(PACK).sort());
  for (const [id, want] of Object.entries(PACK)) {
    const d = PT.Actions.get(id);
    assert.equal(d.label, want.label, id);
    if (want.hold) { assert.equal(d.hold, true); assert.equal(d.release, 400); } else assert.equal(d.duration, want.duration, id);
    const keys = d.settings.map((s) => s.key);
    assert.ok(keys.includes('effects'), `${id} has an Effects checkbox`);
    assert.ok(id === 'spin' || keys.includes('strength'), `${id} has a Strength slider`);
  }
});

for (const id of TIMED) {
  test(`${id}: a whole run moves the avatar, draws, and ends, on either side of the stage`, () => {
    for (const faceX of [300, 960, 1700]) {
      const PT = loadPT();
      fakePose(PT, faceX);
      const project = projectWith(PT, id);
      const { frames, calls } = run(PT, id, project, PACK[id].duration + 200);
      const live = frames.filter((f) => !f.over);
      assert.ok(live.some((f) => Object.values(f.deltas).some((d) => Math.abs(d.ox) + Math.abs(d.oy) + Math.abs(d.rot) > 5 || Math.abs(d.sx - 1) > 0.05)), `${id} moves`);
      assert.ok(drawn(calls) > 0, `${id} draws its extra`);
      assert.ok(frames.filter((f) => f.t >= PACK[id].duration).every((f) => f.over), `${id} ends on time`);
      assert.equal(PT.Actions.active, false);
    }
  });
}

test('with Effects off nothing is drawn', () => {
  for (const id of Object.keys(PACK)) {
    const PT = loadPT();
    fakePose(PT, 960);
    const { calls } = run(PT, id, projectWith(PT, id, { effects: false }), PACK[id].duration || 3000);
    assert.equal(drawn(calls), 0, id);
    PT.Actions.stop();
  }
});

test('with Strength 0 the avatar barely moves', () => {
  for (const id of Object.keys(PACK).filter((x) => x !== 'spin')) {
    const PT = loadPT();
    fakePose(PT, 960);
    const { frames } = run(PT, id, projectWith(PT, id, { strength: 0 }), PACK[id].duration || 3000);
    for (const f of frames) {
      if (f.over) continue;
      for (const [part, d] of Object.entries(f.deltas)) {
        assert.ok(Math.abs(d.ox) + Math.abs(d.oy) + Math.abs(d.rot) < 1e-9, `${id}: ${part} moves at ${f.t}`);
        assert.ok(Math.abs(d.sx - 1) + Math.abs(d.sy - 1) < 1e-9, `${id}: ${part} scales at ${f.t}`);
      }
    }
    PT.Actions.stop();
  }
});

test('spin turns all the way round and back, more times with Turns', () => {
  for (const turns of [1, 3]) {
    const PT = loadPT();
    fakePose(PT, 960);
    const { frames } = run(PT, 'spin', projectWith(PT, 'spin', { turns }), 1400);
    const sx = frames.filter((f) => !f.over).map((f) => f.deltas.torso.sx);
    assert.ok(Math.min(...sx) < -0.9, 'faces the other way');
    let flips = 0;
    for (let i = 1; i < sx.length; i++) if (Math.sign(sx[i]) !== Math.sign(sx[i - 1])) flips++;
    assert.ok(flips >= 2 * turns - 1, `${turns} turn(s): ${flips} flips`);
    assert.ok(Math.abs(sx[sx.length - 1] - 1) < 0.05, 'ends facing forward');
  }
});

test('cheer, wave and victory bring their arms (and the hands hanging from them) to the front', () => {
  const PT = loadPT();
  fakePose(PT, 960);
  const order = PT.normalizeProject({}).order;
  for (const [id, arms] of [['cheer', ['armLUpper', 'armLLower', 'armRUpper', 'armRLower']], ['wave', ['armRUpper', 'armRLower']], ['victory', ['armLUpper', 'armLLower', 'armRUpper', 'armRLower']]]) {
    PT.Actions.play(id, { seed: 1 }, PT.normalizeProject({}), 0);
    PT.Actions.update(500, PT.normalizeProject({}));
    const out = PT.Actions.drawOrder(order);
    assert.deepEqual([...out.slice(-arms.length)].sort(), arms.slice().sort(), id);
    PT.Actions.stop();
  }
});

test('victory pose stays on until it is released, then blends out and ends', () => {
  const PT = loadPT();
  fakePose(PT, 960);
  const project = projectWith(PT, 'victory');
  PT.Actions.play('victory', { seed: 7 }, project, 0);
  const { g } = fakeContext();
  const R = { ctx: g, view: () => [1, 0, 0, 1, 0, 0] };
  let last = null;
  for (let t = 0; t <= 60000; t += 250) { last = PT.Actions.update(t, project); PT.Actions.draw('front', R); }
  assert.ok(last, 'still on after a minute');
  assert.ok(last.deltas.armLUpper.rot > 90 && last.deltas.armRUpper.rot < -90, 'arms up');
  assert.equal(last.states.expression, 'happy');
  assert.equal(PT.Actions.isHeld('victory'), true);

  PT.Actions.release('victory', 60000);
  const mid = PT.Actions.update(60200, project);
  assert.ok(mid && mid.deltas.armLUpper.rot < last.deltas.armLUpper.rot, 'on its way down');
  assert.equal(PT.Actions.update(60450, project), null);
  assert.equal(PT.Actions.active, false);
});

test('the same seed gives the same frames (editor, stage window and OBS agree)', () => {
  const frames = (id) => {
    const PT = loadPT();
    fakePose(PT, 960);
    return JSON.stringify(run(PT, id, projectWith(PT, id), 3000).frames);
  };
  for (const id of ['cheer', 'dance', 'shiver']) assert.equal(frames(id), frames(id), id);
});
