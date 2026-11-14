/* The built-in Basketball action: it loads, and its whole run (dribble, shot, score, party) gives
   sensible poses and draws without errors, on either side of the stage. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
function loadPT() {
  const ctx = { window: {}, navigator: { platform: 'Win32' }, structuredClone, console, performance };
  ctx.window = ctx;
  vm.createContext(ctx);
  for (const f of ['js/util.js', 'js/defs.js', 'js/actions.js', 'js/actions/basketball.js']) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
  }
  return ctx.PT;
}

// a canvas context that counts what is drawn and checks every number it is given
function fakeContext() {
  const calls = {};
  const g = new Proxy({}, {
    get(target, k) {
      if (k in target) return target[k];
      if (k === 'createRadialGradient') return () => ({ addColorStop() {} });
      return (...args) => {
        for (const v of args) if (typeof v === 'number') assert.ok(Number.isFinite(v), `${String(k)} got ${v}`);
        calls[k] = (calls[k] || 0) + 1;
      };
    },
    set(target, k, v) { target[k] = v; return true; },
  });
  return { g, calls };
}

/* The avatar for the action to measure: every part is a 100 x 100 image. The arms hang down from
   the shoulders, the upper arm above the forearm. handOnly: only the upper arms have art. */
function fakePose(PT, faceX, { handOnly = false } = {}) {
  PT.Assets = {
    primary: () => ({ w: 100, h: 100, bbox: { x: 10, y: 10, w: 80, h: 80 } }),
    hasUser: (id) => !handOnly || /Upper$/.test(id),
  };
  const at = (x, y) => ({ world: [1, 0, 0, 1, x, y] });
  const pose = {};
  for (const d of PT.PARTS) pose[d.id] = at(faceX - 50, 300);
  for (const [side, dx] of [['R', 150], ['L', -150]]) {
    pose['arm' + side + 'Upper'] = at(faceX + dx - 50, 420);
    pose['arm' + side + 'Lower'] = at(faceX + dx - 50, 520);
  }
  PT.Actions.setPose(pose, { view: () => [1, 0, 0, 1, 0, 0] });
}

function run(PT, project) {
  const { g, calls } = fakeContext();
  const R = { ctx: g, view: () => [1, 0, 0, 1, 0, 0] };
  assert.equal(PT.Actions.play('basketball', {}, project, 0), true);
  const poses = [];
  for (let t = 0; t <= 8300; t += 50) {
    const f = PT.Actions.update(t, project);
    if (t >= 8200) { assert.equal(f, null, 'over at ' + t); continue; }
    PT.Actions.draw('front', R);
    for (const [id, d] of Object.entries(f.deltas)) for (const v of [d.ox, d.oy, d.rot, d.sx, d.sy]) assert.ok(Number.isFinite(v), `${id} at ${t}`);
    poses.push({ t, deltas: JSON.parse(JSON.stringify(f.deltas)), states: { ...f.states } });
  }
  return { poses, calls };
}

test('the Basketball action is built in, with its settings', () => {
  const PT = loadPT();
  const d = PT.Actions.get('basketball');
  assert.ok(d);
  assert.equal(d.label, 'Basketball');
  assert.equal(d.duration, 8200);
  assert.equal(d.settings.map((s) => s.key).join(), 'size,confetti');
});

test('a whole run: dribble, shoot, score, go wild', () => {
  const PT = loadPT();
  const project = PT.normalizeProject({});
  fakePose(PT, 500);                                   // the avatar on the left: the hoop goes right
  const { poses, calls } = run(PT, project);
  const at = (t) => poses.find((p) => p.t === t);
  // the right arm (screen right) dribbles: out to the side
  assert.ok(at(1000).deltas.armRUpper.rot < -10, 'right arm out: ' + at(1000).deltas.armRUpper.rot);
  // the shot: the right arm is raised, stretched up towards the hoop
  assert.ok(at(3600).deltas.armRUpper.rot < -100, 'raised: ' + at(3600).deltas.armRUpper.rot);
  // the party: both arms up, a jump, the mouth open, the "happy" expression if there is one
  const party = poses.filter((p) => p.t >= 5000 && p.t < 7500);
  assert.ok(party.every((p) => p.deltas.armRUpper.rot < -90 && p.deltas.armLUpper.rot > 90), 'fists up');
  assert.ok(Math.min(...party.map((p) => p.deltas.torso.oy)) < -5, 'jumps');
  assert.ok(party.every((p) => p.states.mouth === 'open' && p.states.expression === 'happy'));
  // talking is left alone while dribbling
  assert.equal(at(1000).states.mouth, undefined);
  // it blends back to rest at the end
  assert.ok(Math.abs(at(8150).deltas.armRUpper.rot) < 25 && Math.abs(at(8150).deltas.armRUpper.rot) < Math.abs(at(7000).deltas.armRUpper.rot) / 4);
  // the ball, hoop, net and confetti were drawn
  assert.ok(calls.arc > 100 && calls.ellipse > 100 && calls.fillRect > 1000, JSON.stringify(calls));
});

test('an avatar on the right shoots with the left arm, at a hoop on the left', () => {
  const PT = loadPT();
  const project = PT.normalizeProject({});
  fakePose(PT, 1500);
  const { poses } = run(PT, project);
  const shot = poses.find((p) => p.t === 3600);
  assert.ok(shot.deltas.armLUpper.rot > 100, 'left arm raised: ' + shot.deltas.armLUpper.rot);
  assert.ok(shot.deltas.face.rot < 0, 'looks left');
});

test('with confetti off, none is drawn', () => {
  const PT = loadPT();
  const project = PT.normalizeProject({ actions: { basketball: { settings: { confetti: false, size: 50 } } } });
  fakePose(PT, 500);
  const { calls } = run(PT, project);
  assert.ok((calls.fillRect || 0) < 200, 'fillRect ' + calls.fillRect);
});

test('the arms come in front of the head from the catch, and go back after', () => {
  const PT = loadPT();
  const project = PT.normalizeProject({});
  fakePose(PT, 500);
  const R = { ctx: fakeContext().g, view: () => [1, 0, 0, 1, 0, 0] };
  PT.Actions.play('basketball', {}, project, 0);
  const top = (t) => { PT.Actions.update(t, project); PT.Actions.draw('front', R); return PT.Actions.drawOrder(project.order).slice(-4).join(); };
  assert.equal(top(1000), project.order.slice(-4).join());            // dribbling: the stacking is the avatar's own
  assert.equal(top(3000), 'armLUpper,armLLower,armRUpper,armRLower'); // the throwing arm on top of everything
  assert.equal(top(6000), 'armLUpper,armLLower,armRUpper,armRLower');
  PT.Actions.update(8300, project);
  assert.equal(PT.Actions.drawOrder(project.order), project.order);   // over: untouched
});

test('the two hands hold the ball in front of the face before the shot', () => {
  const PT = loadPT();
  const project = PT.normalizeProject({});
  fakePose(PT, 500);
  const R = { ctx: fakeContext().g, view: () => [1, 0, 0, 1, 0, 0] };
  PT.Actions.play('basketball', {}, project, 0);
  for (let t = 0; t <= 3300; t += 50) { PT.Actions.update(t, project); PT.Actions.draw('front', R); }
  const run = PT.Actions.running[0], s = run.state;
  assert.ok(s.held, 'held in both hands');
  // in front of the head: between the shoulders, above them
  assert.ok(s.held[0] > s.arms.L.S[0] && s.held[0] < s.arms.R.S[0] + s.r * 2, 'between the shoulders: ' + s.held[0]);
  assert.ok(s.held[1] < s.arms.R.S[1], 'above the shoulders: ' + s.held[1]);
});

test('hand-only arms are moved, not swung', () => {
  const PT = loadPT();
  const project = PT.normalizeProject({});
  fakePose(PT, 500, { handOnly: true });
  const { poses } = run(PT, project);
  const at = (t) => poses.find((p) => p.t === t);
  assert.equal(at(3600).deltas.armRLower, undefined);                // no forearm to bend
  assert.ok(at(3600).deltas.armRUpper.oy < -20, 'the hand goes up: ' + at(3600).deltas.armRUpper.oy);
  assert.ok(Math.abs(at(3600).deltas.armRUpper.rot) < 45, 'and stays the right way up');
  const party = poses.filter((p) => p.t >= 5000 && p.t < 7500);
  assert.ok(party.every((p) => p.deltas.armRUpper.oy < 0 && p.deltas.armLUpper.oy < 0), 'both hands up');
});
