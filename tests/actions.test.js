/* Actions: the browser-side engine (in a sandbox, the way the page loads it) and the server's
   Streamer.bot endpoint, catalog and hotkey route. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const vm = require('node:vm');
const { start, validBinding, actionArgs } = require('../electron/server');

const ROOT = path.join(__dirname, '..');

function loadPT() {
  const ctx = { window: {}, navigator: { platform: 'Win32' }, structuredClone, console, performance };
  ctx.window = ctx;
  vm.createContext(ctx);
  for (const f of ['util.js', 'defs.js', 'actions.js']) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', f), 'utf8'), ctx, { filename: f });
  }
  return ctx.PT;
}

/* ---------------- engine ---------------- */

test('ships with no actions', () => {
  const PT = loadPT();
  assert.equal(PT.Actions.list().length, 0);
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  assert.match(html, /<script src="js\/actions\.js"><\/script>/);
});

test('define checks the id and duration and cleans the settings', () => {
  const { Actions } = loadPT();
  assert.throws(() => Actions.define({ id: '../x', duration: 1000 }));
  assert.throws(() => Actions.define({ id: 'ok', duration: 50 }));
  assert.throws(() => Actions.define({ id: 'ok', duration: 70000 }));
  const d = Actions.define({
    id: 'spin', duration: 1234.4,
    settings: [
      { key: 'speed', type: 'range', min: 1, max: 5, default: 9 },
      { key: 'big', type: 'check', default: 1 },
      { key: 'bad key!', type: 'range' },
    ],
  });
  assert.equal(d.label, 'spin');
  assert.equal(d.duration, 1234);
  assert.equal(d.settings.length, 2);
  assert.equal(d.settings[0].default, 5);          // clamped into range
  assert.equal(d.settings[1].default, true);
  assert.deepEqual(JSON.parse(JSON.stringify(Actions.catalog())), [{ id: 'spin', label: 'spin', duration: 1234 }]);
});

test('settingsFor fills defaults and keeps saved values in range', () => {
  const PT = loadPT();
  const d = PT.Actions.define({ id: 'a', duration: 500, settings: [
    { key: 'h', type: 'range', min: 0, max: 10, default: 4 }, { key: 'on', type: 'check', default: false }] });
  const p = PT.normalizeProject({ parts: {}, actions: { a: { hotkey: 'Ctrl+1', settings: { h: 99, on: true, junk: 'x' } } } });
  assert.deepEqual(JSON.parse(JSON.stringify(p.actions)), { a: { hotkey: 'Ctrl+1', settings: { h: 99, on: true } } });
  assert.deepEqual(JSON.parse(JSON.stringify(PT.Actions.settingsFor(p, d))), { h: 10, on: true });
  assert.deepEqual(JSON.parse(JSON.stringify(PT.Actions.settingsFor(PT.defaultProject(), d))), { h: 4, on: false });
});

test('a play blends onto the idle motion, overrides states and ends after its duration', () => {
  const PT = loadPT();
  const ends = [];
  PT.Actions.define({
    id: 'nod', duration: 1000,
    pose: (a) => ({ face: { rot: 10 * a.t, sy: 2 }, nope: { rot: 5 } }),
    states: () => ({ eyes: 'closed' }),
    end: (a) => ends.push(a.id),
  });
  const p = PT.defaultProject();
  assert.equal(PT.Actions.play('missing', {}, p, 0), false);
  assert.equal(PT.Actions.play('nod', { n: 'x1', seed: 1 }, p, 0), true);
  const f = PT.Actions.update(500, p);
  assert.equal(f.deltas.face.rot, 5);
  assert.equal(f.deltas.nope, undefined);          // unknown parts are ignored
  assert.equal(f.states.eyes, 'closed');
  const merged = PT.Actions.mergeDeltas({ face: { ox: 1, oy: 2, rot: 3, sx: 1, sy: 1.5 } }, f.deltas);
  assert.deepEqual(JSON.parse(JSON.stringify(merged.face)), { ox: 1, oy: 2, rot: 8, sx: 1, sy: 3 });
  assert.equal(PT.Actions.update(1000, p), null);
  assert.deepEqual(ends, ['nod']);
});

test('the same nonce plays once, a replay restarts, overlap adds copies', () => {
  const PT = loadPT();
  PT.Actions.define({ id: 'one', duration: 1000 });
  PT.Actions.define({ id: 'many', duration: 1000, overlap: true });
  const p = PT.defaultProject();
  PT.Actions.play('one', { n: 'a' }, p, 0);
  PT.Actions.play('one', { n: 'a' }, p, 10);       // the same play by a second route
  assert.equal(PT.Actions.running.length, 1);
  assert.equal(PT.Actions.running[0].t0, 0);
  PT.Actions.play('one', { n: 'b' }, p, 20);
  assert.equal(PT.Actions.running.length, 1);
  assert.equal(PT.Actions.running[0].t0, 20);
  PT.Actions.play('many', { n: 'c' }, p, 0);
  PT.Actions.play('many', { n: 'd' }, p, 0);
  assert.equal(PT.Actions.running.length, 3);
});

test('the same seed gives the same random numbers', () => {
  const PT = loadPT();
  const seen = [];
  PT.Actions.define({ id: 'r', duration: 500, start: (a) => seen.push([a.random(), a.random()]) });
  const p = PT.defaultProject();
  PT.Actions.play('r', { n: '1', seed: 42 }, p, 0);
  PT.Actions.play('r', { n: '2', seed: 42 }, p, 0);
  assert.deepEqual(seen[0], seen[1]);
});

test('an action that throws is stopped and reported, the others keep playing', () => {
  const PT = loadPT();
  const errors = [];
  PT.Actions.onError = (def, e) => errors.push(def.id + ': ' + e.message);
  PT.Actions.define({ id: 'bad', duration: 1000, pose: () => { throw new Error('oops'); } });
  PT.Actions.define({ id: 'good', duration: 1000, pose: () => ({ torso: { oy: 3 } }) });
  const p = PT.defaultProject();
  PT.Actions.play('bad', {}, p, 0);
  PT.Actions.play('good', {}, p, 0);
  const f = PT.Actions.update(100, p);
  assert.equal(f.deltas.torso.oy, 3);
  assert.deepEqual(errors, ['bad: oops']);
  assert.deepEqual([...PT.Actions.running.map((r) => r.def.id)], ['good']);
});

test('envelope, between and part offsets', () => {
  const PT = loadPT();
  let ctx;
  PT.Actions.define({ id: 'e', duration: 1000, pose: (a) => { ctx = a; }, parts: (a, id) => (id === 'face' ? { dx: 5, scale: 2, alpha: 0.5 } : null) });
  PT.Actions.define({ id: 'f', duration: 1000, parts: (a, id) => (id === 'face' ? { dx: 1, hide: true } : null) });
  const p = PT.defaultProject();
  PT.Actions.play('e', {}, p, 0);
  PT.Actions.play('f', {}, p, 0);
  PT.Actions.update(100, p);
  assert.equal(ctx.envelope(200, 200), 0.5);
  assert.equal(ctx.between(0, 0.2), 0.5);
  assert.deepEqual(JSON.parse(JSON.stringify(PT.Actions.partFx('face'))), { dx: 6, dy: 0, rot: 0, scale: 2, alpha: 0.5, hide: true });
  assert.equal(PT.Actions.partFx('torso'), null);
  const both = PT.Actions.combineFx({ dx: 1, dy: 2, rot: 3 }, { dx: 1, scale: 2 });
  assert.deepEqual(JSON.parse(JSON.stringify(both)), { dx: 2, dy: 2, rot: 3, scale: 2, alpha: 1, hide: false });
});

/* ---------------- server ---------------- */

test('validBinding accepts action hotkeys', () => {
  assert.ok(validBinding({ accelerator: 'Ctrl+Alt+W', action: 'action:wave' }));
  assert.ok(validBinding({ accelerator: 'F8', action: 'action:big_spin-2' }));
  assert.equal(validBinding({ accelerator: 'Ctrl+1', action: 'action:' }), false);
  assert.equal(validBinding({ accelerator: 'Ctrl+1', action: 'action:../x' }), false);
});

function request(port, method, p, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path: p, headers }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

// listens to the event stream; events = [{ event, data, at }]
function listen(port) {
  const events = [];
  let req;
  const ready = new Promise((resolve, reject) => {
    req = http.get({ host: '127.0.0.1', port, path: '/api/events' }, (res) => {
      let buf = '';
      res.on('data', (c) => {
        buf += c;
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const block = buf.slice(0, i); buf = buf.slice(i + 2);
          const ev = /^event: (.*)$/m.exec(block), data = /^data: (.*)$/m.exec(block);
          if (!ev) continue;
          if (ev[1] === 'hello') resolve();
          else events.push({ event: ev[1], data: JSON.parse(data[1]), at: Date.now() });
        }
      });
    });
    req.on('error', reject);
  });
  const waitFor = async (count, ms = 3000) => {
    const t0 = Date.now();
    while (events.length < count) {
      if (Date.now() - t0 > ms) throw new Error(`waited for ${count} events, got ${events.length}`);
      await new Promise((r) => setTimeout(r, 10));
    }
    return events;
  };
  return { ready, events, waitFor, close: () => req.destroy() };
}

async function server(t, port) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'easytuber-test-'));
  const srv = await start({ root: ROOT, saveFile: path.join(dir, 'avatar.json'), port });
  const sse = listen(srv.port);
  await sse.ready;
  t.after(() => { sse.close(); srv.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  const json = { 'Content-Type': 'application/json' };
  const setCatalog = (actions) => request(srv.port, 'POST', '/api/actions', JSON.stringify({ actions }), json);
  const sb = (query, headers = { 'X-EasyTuber-Control': 'streamerbot' }) =>
    request(srv.port, 'GET', '/api/streamerbot?' + query, undefined, headers);
  return { srv, sse, setCatalog, sb };
}

test('/api/actions takes the editor\'s list, JSON only', async (t) => {
  const { srv, setCatalog } = await server(t, 18801);
  assert.equal((await setCatalog([{ id: 'wave', label: 'Wave', duration: 1500 }])).status, 200);
  assert.equal((await setCatalog([{ id: 'bad id', duration: 1500 }])).status, 400);
  assert.equal((await setCatalog([{ id: 'x', duration: 5 }])).status, 400);
  const plain = await request(srv.port, 'POST', '/api/actions', JSON.stringify({ actions: [] }), { 'Content-Type': 'text/plain' });
  assert.equal(plain.status, 415);
});

test('/api/streamerbot plays one action on every page', async (t) => {
  const { sse, setCatalog, sb } = await server(t, 18802);
  await setCatalog([{ id: 'wave', label: 'Wave', duration: 1500 }]);

  assert.equal((await sb('action=wave', {})).status, 403);                       // no header
  assert.equal((await sb('action=nope')).status, 404);
  assert.equal((await sb('action=wave&delay=1')).status, 400);                    // timing needs a sequence
  assert.equal((await sb('action=wave&action=wave')).status, 400);

  assert.equal((await sb('action=wave')).status, 202);
  const [e] = await sse.waitFor(1);
  assert.equal(e.event, 'live');
  assert.equal(e.data.type, 'action');
  assert.equal(e.data.id, 'wave');
  assert.equal(typeof e.data.n, 'string');
  assert.ok(Number.isInteger(e.data.seed));

  // avatar steps go to the editor as hotkey events
  assert.equal((await sb('action=next')).status, 202);
  const events = await sse.waitFor(2);
  assert.deepEqual(events[1].data, { action: 'next' });
  assert.equal(events[1].event, 'hotkey');
});

test('/api/streamerbot sequences: start delay, fixed delay, one at a time', async (t) => {
  const { sse, setCatalog, sb } = await server(t, 18803);
  await setCatalog([{ id: 'a', duration: 300 }, { id: 'b', duration: 100 }]);

  assert.equal((await sb('sequence=' + Array(9).fill('a').join(','))).status, 400);
  assert.equal((await sb('sequence=a,b&delay=0')).status, 400);
  assert.equal((await sb('sequence=a,b&startDelay=0.25')).status, 400);          // tenths only

  const t0 = Date.now();
  assert.equal((await sb('sequence=a,b,random&startDelay=0.2&delay=0.1')).status, 202);
  assert.equal((await sb('sequence=a')).status, 409);                             // one sequence at a time
  const ev = await sse.waitFor(3);
  assert.deepEqual(ev.map((e) => e.data.id || e.data.action), ['a', 'b', 'random']);
  assert.ok(ev[0].at - t0 >= 180, 'start delay');
  assert.ok(ev[2].at - ev[0].at >= 180, 'fixed delay between steps');

  // without a fixed delay each step waits for the one before to finish (a = 300 ms)
  await new Promise((r) => setTimeout(r, 50));
  assert.equal((await sb('sequence=a,b')).status, 202);
  const ev2 = await sse.waitFor(5);
  assert.ok(ev2[4].at - ev2[3].at >= 280, 'waited for the first action');
});

test('a hotkey press plays an action from the server, avatar keys go to the editor', async (t) => {
  const { srv, sse, setCatalog } = await server(t, 18804);
  await setCatalog([{ id: 'wave', duration: 1000 }]);
  srv.trigger('action:wave');
  srv.trigger('action:unknown');                 // ignored
  srv.trigger('random');
  const ev = await sse.waitFor(2);
  assert.equal(ev[0].data.id, 'wave');
  assert.deepEqual(ev[1], { ...ev[1], event: 'hotkey', data: { action: 'random' } });
});

/* ---------------- /api/live and the local-only rule ---------------- */

test('/api/live passes the editor\'s messages on, JSON only, and never an action', async (t) => {
  const { srv, sse } = await server(t, 18830);
  const json = { 'Content-Type': 'application/json' };
  const live = (body, headers = json) => request(srv.port, 'POST', '/api/live', body, headers);

  assert.equal((await live(JSON.stringify({ type: 'level', v: 0.5 }))).status, 204);
  assert.deepEqual((await sse.waitFor(1))[0], { event: 'live', data: { type: 'level', v: 0.5 }, at: sse.events[0].at });

  // what a form or a script on another website can send without asking first
  assert.equal((await live(JSON.stringify({ type: 'level', v: 1 }), {})).status, 415);
  assert.equal((await live(JSON.stringify({ type: 'level', v: 1 }), { 'Content-Type': 'text/plain' })).status, 415);
  // actions only start at /api/streamerbot or a hotkey
  assert.equal((await live(JSON.stringify({ type: 'action', id: 'wave', n: 'x', seed: 1 }))).status, 400);
  assert.equal((await live('[1]')).status, 400);
  assert.equal((await live('null')).status, 400);
  assert.equal((await live('{')).status, 400);

  await new Promise((r) => setTimeout(r, 50));
  assert.equal(sse.events.length, 1);
});

test('the API only answers to a local address', async (t) => {
  const { srv } = await server(t, 18831);
  const as = (host, p = '/api/ping') => request(srv.port, 'GET', p, undefined, { Host: host });
  assert.equal((await as(`127.0.0.1:${srv.port}`)).status, 200);
  assert.equal((await as(`localhost:${srv.port}`)).status, 200);
  // another site's name pointed at this computer
  assert.equal((await as(`evil.example:${srv.port}`)).status, 403);
  assert.equal((await as('evil.example')).status, 403);
  assert.equal((await as(`evil.example:${srv.port}`, '/api/project')).status, 403);
  assert.equal((await as(`evil.example:${srv.port}`, '/api/events')).status, 403);
  // the page itself is not secret
  assert.equal((await as(`evil.example:${srv.port}`, '/')).status, 200);
});

/* ---------------- drop-in action files ---------------- */

test('loadAll adds one script per file, in order, and reports the files that fail', async () => {
  const PT = loadPT();
  const listeners = new Set();
  const win = { addEventListener: (_n, fn) => listeners.add(fn), removeEventListener: (_n, fn) => listeners.delete(fn) };
  const added = [];
  // a stand-in page: "running" a file means calling what the test says that file does
  const files = {
    'js/actions/wave.js': () => PT.Actions.define({ id: 'wave', label: 'App wave', duration: 500 }),
    'user-actions/wave.js': () => PT.Actions.define({ id: 'wave', label: 'My wave', duration: 900 }),
    'user-actions/empty.js': () => {},
    'user-actions/typo.js': () => { for (const fn of listeners) fn({ filename: 'http://localhost:8777/user-actions/typo.js', message: 'Unexpected token' }); },
    'user-actions/gone.js': null,
  };
  const doc = {
    createElement: () => ({}),
    head: { appendChild(tag) {
      added.push(tag.src);
      const run = files[tag.src];
      setTimeout(() => { if (run) { run(); tag.onload(); } else tag.onerror(); }, 0);
    } },
  };
  const res = await PT.Actions.loadAll(Object.keys(files).map((src) => ({ src })), doc, win);
  assert.deepEqual(added, Object.keys(files));
  assert.equal(res.loaded, 2);
  assert.deepEqual(JSON.parse(JSON.stringify(res.failed)), [
    { src: 'user-actions/empty.js', message: 'has no PT.Actions.define()' },
    { src: 'user-actions/typo.js', message: 'Unexpected token' },
    { src: 'user-actions/gone.js', message: 'could not be read' },
  ]);
  // the user's file came second, so it replaced the app's action of the same id
  assert.equal(PT.Actions.list().length, 1);
  assert.equal(PT.Actions.get('wave').label, 'My wave');
  assert.equal(listeners.size, 0);
});

test('/api/action-files lists the app\'s and the user\'s action files, and the user folder is served', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'easytuber-test-'));
  const root = path.join(dir, 'app'), actionsDir = path.join(dir, 'actions');
  fs.mkdirSync(path.join(root, 'js', 'actions'), { recursive: true });
  fs.mkdirSync(path.join(actionsDir, 'spin'), { recursive: true });
  fs.writeFileSync(path.join(root, 'index.html'), '<html></html>');
  fs.writeFileSync(path.join(root, 'js', 'actions', 'wave.js'), '// app');
  fs.writeFileSync(path.join(root, 'js', 'actions', 'README.md'), 'not an action');
  fs.writeFileSync(path.join(actionsDir, 'spin.js'), '// spin');
  fs.writeFileSync(path.join(actionsDir, 'bow.js'), '// bow');
  fs.writeFileSync(path.join(actionsDir, 'bad name.js'), '// skipped');
  fs.writeFileSync(path.join(actionsDir, 'notes.txt'), 'skipped');
  fs.writeFileSync(path.join(actionsDir, 'spin', 'star.png'), 'png');
  fs.writeFileSync(path.join(dir, 'secret.txt'), 'outside');
  let opened = 0;
  const srv = await start({ root, saveFile: path.join(dir, 'avatar.json'), port: 18840, actionsDir, onOpenFolder: async () => { opened++; return ''; } });
  t.after(() => { srv.close(); fs.rmSync(dir, { recursive: true, force: true }); });

  const list = JSON.parse((await request(srv.port, 'GET', '/api/action-files')).body);
  assert.deepEqual(list.files, [
    { src: 'js/actions/wave.js', from: 'app' },
    { src: 'user-actions/bow.js', from: 'user' },
    { src: 'user-actions/spin.js', from: 'user' },
  ]);
  assert.equal(list.folder, actionsDir);

  const file = await request(srv.port, 'GET', '/user-actions/spin.js');
  assert.equal(file.status, 200);
  assert.equal(file.body, '// spin');
  assert.equal((await request(srv.port, 'GET', '/user-actions/spin/star.png')).status, 200);
  assert.equal((await request(srv.port, 'GET', '/user-actions/nope.js')).status, 404);
  // nothing outside the folder
  for (const p of ['/user-actions/../secret.txt', '/user-actions/%2e%2e/secret.txt', '/user-actions/..%5csecret.txt', '/user-actions/%2e%2e%2favatar.json']) {
    const r = await request(srv.port, 'GET', p);
    assert.ok(r.status === 403 || r.status === 404, `${p} -> ${r.status}`);
    assert.notEqual(r.body, 'outside');
  }

  const json = { 'Content-Type': 'application/json' };
  assert.equal((await request(srv.port, 'POST', '/api/open-folder', JSON.stringify({ folder: 'actions' }), json)).status, 200);
  assert.equal(opened, 1);
  assert.equal((await request(srv.port, 'POST', '/api/open-folder', JSON.stringify({ folder: '/' }), json)).status, 400);
  assert.equal((await request(srv.port, 'POST', '/api/open-folder', JSON.stringify({ folder: 'actions' }), {})).status, 415);
  assert.equal(opened, 1);
});

test('without an actions folder only the app\'s files are listed', async (t) => {
  const { srv } = await server(t, 18841);
  const list = JSON.parse((await request(srv.port, 'GET', '/api/action-files')).body);
  assert.deepEqual(list, { files: [], folder: '' });                       // EASY-TUBER ships none
  assert.equal((await request(srv.port, 'GET', '/user-actions/x.js')).status, 404);
  const json = { 'Content-Type': 'application/json' };
  assert.equal((await request(srv.port, 'POST', '/api/open-folder', JSON.stringify({ folder: 'actions' }), json)).status, 501);
});

/* ---------------- values for an action (a.args) ---------------- */

test('a play carries its values to every hook as a.args, text only and read-only', () => {
  const PT = loadPT();
  let seen = null;
  PT.Actions.define({ id: 'hi', duration: 1000, start(a) { seen = a.args; }, pose(a) { a.state.user = a.args.user; return null; } });
  const p = PT.normalizeProject({ parts: {} });

  PT.Actions.play('hi', { n: 'a', seed: 1, args: { user: 'Bob', amount: 500, 'bad key': 'x', obj: { a: 1 }, long: 'x'.repeat(300) } }, p, 0);
  assert.deepEqual(JSON.parse(JSON.stringify(seen)), { user: 'Bob', amount: '500', long: 'x'.repeat(200) });
  assert.ok(Object.isFrozen(seen));
  PT.Actions.update(10, p);
  assert.equal(PT.Actions.running[0].state.user, 'Bob');

  // no values: still an object, so a.args.user is simply undefined
  for (const args of [undefined, null, 'text', [1, 2]]) {
    PT.Actions.play('hi', { n: 'n' + String(args), seed: 1, args }, p, 0);
    assert.deepEqual(JSON.parse(JSON.stringify(seen)), {});
  }
  assert.deepEqual(JSON.parse(JSON.stringify(PT.Actions.newPlay('hi', { user: 'Ann' }).args)), { user: 'Ann' });
  assert.equal('args' in PT.Actions.newPlay('hi'), false);
});

test('actionArgs reads the values from a Streamer.bot URL and refuses bad ones', () => {
  const args = (q) => actionArgs(new URLSearchParams(q));
  assert.equal(args('action=wave'), null);
  assert.equal(args('sequence=a,b&startDelay=1&delay=2'), null);
  assert.deepEqual(args('action=wave&user=Bob%20Smith&amount=500&empty='), { user: 'Bob Smith', amount: '500', empty: '' });
  assert.deepEqual(args('action=wave&user=%25user%25'), { user: '%user%' });
  assert.equal(typeof args('action=wave&bad%20key=1'), 'string');
  assert.equal(typeof args('action=wave&__proto__=1'), 'string');
  assert.equal(typeof args('action=wave&user=a&user=b'), 'string');
  assert.equal(typeof args('action=wave&user=' + 'x'.repeat(201)), 'string');
  assert.equal(typeof args('action=wave&' + Array.from({ length: 17 }, (_, i) => `k${i}=1`).join('&')), 'string');
  assert.equal(typeof args('action=wave&' + Array.from({ length: 16 }, (_, i) => `k${i}=1`).join('&')), 'object');
});

test('/api/streamerbot passes the values on with the action, and to every action in a sequence', async (t) => {
  const { sse, setCatalog, sb } = await server(t, 18850);
  await setCatalog([{ id: 'wave', label: 'Wave', duration: 100 }, { id: 'bow', label: 'Bow', duration: 100 }]);

  assert.equal((await sb('action=wave&user=Bob&amount=500')).status, 202);
  let ev = (await sse.waitFor(1))[0];
  assert.equal(ev.data.id, 'wave');
  assert.deepEqual(ev.data.args, { user: 'Bob', amount: '500' });

  assert.equal((await sb('action=wave')).status, 202);
  ev = (await sse.waitFor(2))[1];
  assert.equal('args' in ev.data, false);

  assert.equal((await sb('sequence=wave,next,bow&delay=0.1&user=Ann')).status, 202);
  const evs = await sse.waitFor(5);
  assert.deepEqual(evs.slice(2).map((e) => [e.event, e.data.id || e.data.action, e.data.args]), [
    ['live', 'wave', { user: 'Ann' }], ['hotkey', 'next', undefined], ['live', 'bow', { user: 'Ann' }],
  ]);

  const bad = await sb('action=wave&bad%20key=1');
  assert.equal(bad.status, 400);
  assert.match(JSON.parse(bad.body).error, /bad key/);
  assert.equal((await sb('action=wave&user=a&user=b')).status, 400);
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(sse.events.length, 5);
});
