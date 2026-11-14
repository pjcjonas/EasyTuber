/* EASY-TUBER local server (runs inside the Electron main process).
   - Serves the app on http://localhost:<port>/ so OBS can load it as a Browser Source.
   - Keeps the avatar in a file, so OBS (which has its own browser storage) sees the same avatar.
   - Relays the editor's mic level / blinks to stage pages with Server-Sent Events.
   - Passes hotkey and virtual-camera requests from the editor on to the desktop app.
   - Lists the action files (the app's js/actions/ and the user's actions folder) for the pages to load. */
const http = require('http');
const fs = require('fs');
const path = require('path');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.ico': 'image/x-icon', '.svg': 'image/svg+xml',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.mp4': 'video/mp4',
  // pictures and sounds for actions
  '.webp': 'image/webp', '.gif': 'image/gif', '.webm': 'video/webm',
  '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.m4a': 'audio/mp4',
};
const STATIC_DIRS = ['css', 'js', 'build', 'media'];
const USER_ACTIONS = 'user-actions';          // URL folder for the user's actions folder
const ACTION_FILE = /^[\w-]{1,40}\.js$/;      // an action file: <id>.js
const MAX_BODY = 1024 * 1024 * 1024;   // several avatars' images, as data URLs

/* A global hotkey binding from the page: { accelerator: "Ctrl+Alt+1", action: "avatar:<id>" | "next" | "random" }.
   A key with no modifier is only allowed for F-keys and the numpad: a bare letter would stop
   working in every other program while the app runs. */
const MODIFIERS = new Set(['Ctrl', 'Control', 'Alt', 'Shift', 'Super', 'Cmd', 'Command', 'CommandOrControl', 'CmdOrCtrl', 'Option', 'Meta']);
const SOLO_KEY = /^(F([1-9]|1\d|2[0-4])|num(\d|add|sub|mult|div|dec))$/;
const KEY = /^([A-Z0-9]|F([1-9]|1\d|2[0-4])|num(\d|add|sub|mult|div|dec)|Space|Up|Down|Left|Right|Home|End|PageUp|PageDown|Insert|Delete|Plus|[-=[\];',./\\`])$/;
const AVATAR_ACTION = /^(next|random|avatar:[\w-]{1,40})$/;
const ACTION_ID = /^[\w-]{1,40}$/;
const SWITCH_MS = 1800;        // an avatar switch in a sequence: drop out + climb back in
const MAX_STEPS = 8;
const RESERVED = new Set(['action', 'sequence', 'startDelay', 'delay', 'stop', 'hold']);   // the URL's own options
const ARG_KEY = /^[\w-]{1,40}$/;
const MAX_ARGS = 16, MAX_ARG_LENGTH = 200;

/* Values for the action, from the rest of a Streamer.bot URL: ?action=wave&user=Bob&amount=500
   gives { user: 'Bob', amount: '500' }. Returns the values (null when there are none), or a
   string saying what is wrong. */
function actionArgs(params) {
  const out = {};
  let count = 0;
  for (const [key, value] of params) {
    if (RESERVED.has(key)) continue;
    if (!ARG_KEY.test(key) || key === '__proto__') return `"${key.slice(0, 40)}" is not a name an action value can have (letters, digits, - and _)`;
    if (key in out) return `"${key}" is given twice`;
    if (value.length > MAX_ARG_LENGTH) return `"${key}" is longer than ${MAX_ARG_LENGTH} characters`;
    if (++count > MAX_ARGS) return `An action takes up to ${MAX_ARGS} values`;
    out[key] = value;
  }
  return count ? out : null;
}
function validBinding(b) {
  if (!b || typeof b.accelerator !== 'string' || typeof b.action !== 'string') return false;
  if (b.accelerator.length > 64 || !(AVATAR_ACTION.test(b.action) || /^action:[\w-]{1,40}$/.test(b.action))) return false;
  const parts = b.accelerator.split('+');
  const key = parts.pop(), mods = parts;
  if (!KEY.test(key) || !mods.every((m) => MODIFIERS.has(m)) || new Set(mods).size !== mods.length) return false;
  return mods.length > 0 || SOLO_KEY.test(key);
}

/* A sequence timing option in seconds, to a tenth: undefined when absent, NaN when invalid. */
function seconds(params, key, minimum) {
  const values = params.getAll(key);
  if (!values.length) return undefined;
  const s = Number(values[0]);
  if (values.length !== 1 || !/^\d+(\.\d)?$/.test(values[0]) || s < minimum || s > 60) return NaN;
  return Math.round(s * 1000);
}

/* The editor's list of actions (js/actions/*.js): [{ id, label, duration }] -> Map, or null if bad. */
function parseCatalog(list) {
  if (!Array.isArray(list) || list.length > 200) return null;
  const out = new Map();
  for (const a of list) {
    if (!a || typeof a.id !== 'string' || !ACTION_ID.test(a.id)) return null;
    // a held action has no length: it runs until it is stopped
    const hold = a.hold === true;
    if (!hold && (!Number.isFinite(a.duration) || a.duration < 100 || a.duration > 60000)) return null;
    out.set(a.id, { label: typeof a.label === 'string' ? a.label.slice(0, 60) : a.id, duration: hold ? 0 : Math.round(a.duration), hold });
  }
  return out;
}

/* The action files in a folder, in name order. A folder that isn't there has none. */
async function actionFiles(dir) {
  if (!dir) return [];
  try {
    const names = await fs.promises.readdir(dir, { withFileTypes: true });
    return names.filter((d) => d.isFile() && ACTION_FILE.test(d.name)).map((d) => d.name).sort();
  } catch (e) { return []; }
}

function start({ root, saveFile, port = 8777, tries = 10, onHotkeys = null, onVcam = null, actionsDir = null, onOpenFolder = null }) {
  let version = 0;
  const listeners = new Set();
  let catalog = new Map();       // actions the editor has loaded
  let sequenceTimer = null;      // a sequence step waiting to play
  let nonce = 0;
  const held = new Map();        // held actions that are on: id -> the message that started it

  const broadcast = (event, data) => {
    const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of listeners) { try { res.write(msg); } catch (e) { listeners.delete(res); } }
  };

  /* ---- actions ----
     A step is an action from the catalog (played by every page) or an avatar switch (done by the
     editor). Each play gets a nonce, so a page that hears it twice plays it once, and a seed, so
     random choices come out the same in the editor and in OBS. */
  const stepFor = (name) => {
    if (ACTION_ID.test(name) && catalog.has(name)) return { name, event: 'live', wait: catalog.get(name).duration, hold: catalog.get(name).hold };
    if (AVATAR_ACTION.test(name)) return { name, event: 'hotkey', wait: SWITCH_MS };
    return null;
  };
  /* A held action stays on until it is stopped, so playing it is a switch: `want` = true (on),
     false (off) or undefined (the other way). Returns true / false for a held action that is now
     on / off, undefined for anything else. */
  const playStep = (step, args = null, want = undefined) => {
    if (step.event === 'hotkey') { broadcast('hotkey', { action: step.name }); return undefined; }
    const on = held.has(step.name);
    if (step.hold) {
      if (want === undefined) want = !on;
      if (want === on) return on;                       // already there
      if (!want) { stopHeld(step.name); return false; }
    }
    const msg = {
      type: 'action', id: step.name,
      n: Date.now().toString(36) + '-' + (++nonce).toString(36), seed: Math.floor(Math.random() * 4294967296),
    };
    if (args) msg.args = args;   // values from the URL, read by the action as a.args
    if (step.hold) held.set(step.name, msg);
    broadcast('live', msg);
    return step.hold ? true : undefined;
  };
  // stop one action, or every action (and a sequence that is waiting) when there is no id
  const stopHeld = (id) => {
    if (id) held.delete(id);
    else { held.clear(); clearTimeout(sequenceTimer); sequenceTimer = null; }
    broadcast('live', id ? { type: 'action-stop', id } : { type: 'action-stop' });
  };
  // steps play one after another: each waits for the one before to finish, or for `delay` ms if given
  const runSequence = (steps, { startDelay = 0, delay, args = null } = {}) => {
    const next = (i, wait) => {
      if (i >= steps.length) { sequenceTimer = null; return; }
      sequenceTimer = setTimeout(() => {
        playStep(steps[i], args);
        next(i + 1, delay ?? steps[i].wait);
      }, wait);
      if (sequenceTimer.unref) sequenceTimer.unref();
    };
    if (startDelay > 0) next(0, startDelay);
    else { playStep(steps[0], args); next(1, delay ?? steps[0].wait); }
  };
  /* a global hotkey press (main.js): actions play straight from here, avatar switches go to the editor */
  const trigger = (action) => {
    const m = /^action:([\w-]{1,40})$/.exec(action);
    if (!m) return broadcast('hotkey', { action });
    const step = stepFor(m[1]);
    if (step) playStep(step);
  };

  const sendJson = (res, code, obj) => {
    const body = JSON.stringify(obj);
    res.writeHead(code, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), 'Cache-Control': 'no-store' });
    res.end(body);
  };

  const readBody = (req) => new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(new Error('too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });

  const serveStatic = (req, res, urlPath) => {
    let rel;
    try { rel = urlPath === '/' ? 'index.html' : decodeURIComponent(urlPath.slice(1)); } catch (e) { res.writeHead(400); return res.end(); }
    rel = path.normalize(rel).replace(/^(\.\.[/\\])+/, '');
    const [top, ...rest] = rel.split(/[/\\]/);
    // user-actions/... is the user's actions folder: action files, and their pictures and sounds
    const user = top === USER_ACTIONS && !!actionsDir;
    if (rel !== 'index.html' && !user && !STATIC_DIRS.includes(top)) { res.writeHead(404); return res.end('Not found'); }
    const base = user ? actionsDir : root;
    const file = path.join(base, user ? rest.join(path.sep) : rel);
    if (file !== base && !file.startsWith(base + path.sep)) { res.writeHead(403); return res.end(); }
    const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
    fs.stat(file, (err, st) => {
      if (err || !st.isFile()) { res.writeHead(404); return res.end('Not found'); }
      // byte ranges, so the video element can stream and seek
      const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
      if (m && (m[1] || m[2])) {
        let startB = m[1] ? parseInt(m[1], 10) : st.size - parseInt(m[2], 10);
        let endB = m[1] && m[2] ? parseInt(m[2], 10) : st.size - 1;
        startB = Math.max(0, startB); endB = Math.min(endB, st.size - 1);
        if (startB > endB) { res.writeHead(416, { 'Content-Range': `bytes */${st.size}` }); return res.end(); }
        res.writeHead(206, {
          'Content-Type': type, 'Cache-Control': 'no-store', 'Accept-Ranges': 'bytes',
          'Content-Range': `bytes ${startB}-${endB}/${st.size}`, 'Content-Length': endB - startB + 1,
        });
        return fs.createReadStream(file, { start: startB, end: endB }).pipe(res);
      }
      res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store', 'Accept-Ranges': 'bytes', 'Content-Length': st.size });
      fs.createReadStream(file).pipe(res);
    });
  };

  const server = http.createServer(async (req, res) => {
    const urlPath = req.url.split('?')[0];
    try {
      /* The API is for this computer only. A page on another site could point its own name at
         127.0.0.1 to get round the browser's same-site rule; its requests carry that name as Host. */
      if (urlPath.startsWith('/api/')) {
        const port = req.socket.localPort, host = req.headers.host;
        if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) return sendJson(res, 403, { error: 'Use a local URL' });
      }
      if (urlPath === '/api/ping' && req.method === 'GET') return sendJson(res, 200, { ok: true, version });

      if (urlPath === '/api/project') {
        if (req.method === 'GET') {
          return fs.readFile(saveFile, (err, data) => {
            if (err) return sendJson(res, 404, { error: 'no avatar saved yet' });
            res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': data.length, 'Cache-Control': 'no-store' });
            res.end(data);
          });
        }
        if (req.method === 'PUT') {
          const body = await readBody(req);
          let data;
          try { data = JSON.parse(body); } catch (e) { return sendJson(res, 400, { error: 'bad json' }); }
          if (!data || typeof data !== 'object' || !data.parts) return sendJson(res, 400, { error: 'not an EASY-TUBER project' });
          await fs.promises.mkdir(path.dirname(saveFile), { recursive: true });
          const tmp = saveFile + '.tmp';
          await fs.promises.writeFile(tmp, body);
          await fs.promises.rename(tmp, saveFile);
          version++;
          broadcast('project', { version, savedAt: data.savedAt || 0 });
          return sendJson(res, 200, { ok: true, version });
        }
      }

      /* Which action files there are: the app's own (js/actions/) first, then the user's folder.
         Every page loads them in this order, so a user file can replace one of the app's. */
      if (urlPath === '/api/action-files' && req.method === 'GET') {
        const [app, user] = await Promise.all([actionFiles(path.join(root, 'js', 'actions')), actionFiles(actionsDir)]);
        return sendJson(res, 200, {
          files: [...app.map((f) => ({ src: 'js/actions/' + f, from: 'app' })), ...user.map((f) => ({ src: USER_ACTIONS + '/' + f, from: 'user' }))],
          folder: actionsDir || '',
        });
      }

      // "Open actions folder" in the editor: the desktop app shows the folder in the file manager
      if (urlPath === '/api/open-folder' && req.method === 'POST') {
        if (!/^application\/json\b/.test(req.headers['content-type'] || '')) return sendJson(res, 415, { error: 'json only' });
        if (!onOpenFolder) return sendJson(res, 501, { error: 'not available outside the desktop app' });
        let data;
        try { data = JSON.parse(await readBody(req)); } catch (e) { return sendJson(res, 400, { error: 'bad json' }); }
        if (!data || data.folder !== 'actions') return sendJson(res, 400, { error: 'unknown folder' });
        const error = await onOpenFolder('actions');
        return error ? sendJson(res, 500, { error }) : sendJson(res, 200, { ok: true });
      }

      // the editor says which actions it has loaded, so Streamer.bot requests can be checked and timed
      if (urlPath === '/api/actions' && req.method === 'POST') {
        if (!/^application\/json\b/.test(req.headers['content-type'] || '')) return sendJson(res, 415, { error: 'json only' });
        let data;
        try { data = JSON.parse(await readBody(req)); } catch (e) { return sendJson(res, 400, { error: 'bad json' }); }
        const next = parseCatalog(data && data.actions);
        if (!next) return sendJson(res, 400, { error: 'bad action list' });
        catalog = next;
        // a held action whose file is gone (or is no longer a held one) can't be left on
        for (const id of [...held.keys()]) if (!catalog.has(id) || !catalog.get(id).hold) stopHeld(id);
        return sendJson(res, 200, { ok: true, count: catalog.size, held: [...held.keys()] });
      }

      /* Streamer.bot (Fetch URL sub-action), or the editor's Test button:
           /api/streamerbot?action=<id>                       one action, or next / random / avatar:<id>
           /api/streamerbot?sequence=a,b,c&startDelay=1&delay=2.5   up to 8 steps, timing in seconds
           /api/streamerbot?action=<id>&user=Bob&amount=500   anything else is a value for the action (a.args)
           /api/streamerbot?action=<id>            on a held action: turns it on, or off if it is on
           /api/streamerbot?action=<id>&hold=on    a held action: on (off: hold=off)
           /api/streamerbot?stop=<id>  or  stop=all           stop one action, or everything
         Only from this computer, and only with the header X-EasyTuber-Control: streamerbot. A web page
         can't add that header without a CORS preflight, which is refused, so websites can't trigger it. */
      if (urlPath === '/api/streamerbot' && req.method === 'GET') {
        const port = req.socket.localPort;
        if (req.headers['x-easytuber-control'] !== 'streamerbot') {
          return sendJson(res, 403, { error: 'Use a local URL and send the header X-EasyTuber-Control: streamerbot' });
        }
        const params = new URL(req.url, `http://127.0.0.1:${port}`).searchParams;
        const singles = params.getAll('action'), sequences = params.getAll('sequence'), stops = params.getAll('stop');
        if (singles.length + sequences.length + stops.length !== 1) return sendJson(res, 400, { error: 'Send one action=, one sequence= or one stop=' });
        if (stops.length) {
          if ([...params.keys()].length !== 1) return sendJson(res, 400, { error: 'stop= takes nothing else' });
          if (stops[0] === 'all') { stopHeld(); return sendJson(res, 202, { accepted: true }); }
          if (!ACTION_ID.test(stops[0]) || !catalog.has(stops[0])) return sendJson(res, 404, { error: 'Unknown action: ' + stops[0].slice(0, 40) + (catalog.size ? '' : ' (is the editor open?)') });
          stopHeld(stops[0]);
          return sendJson(res, 202, { accepted: true, on: false });
        }
        const holds = params.getAll('hold');
        if (holds.length > 1 || (holds.length && !['on', 'off'].includes(holds[0]))) return sendJson(res, 400, { error: 'hold must be on or off' });
        const want = holds.length ? holds[0] === 'on' : undefined;
        const names = sequences.length ? sequences[0].split(',').map((s) => s.trim()) : singles;
        if (!names.length || names.length > MAX_STEPS) return sendJson(res, 400, { error: `A sequence has 1 to ${MAX_STEPS} steps` });
        const steps = names.map(stepFor);
        const unknown = names.filter((n, i) => !steps[i]);
        if (unknown.length) return sendJson(res, 404, { error: 'Unknown action: ' + unknown.join(', ') + (catalog.size ? '' : ' (is the editor open?)') });
        const startDelay = seconds(params, 'startDelay', 0), delay = seconds(params, 'delay', 0.1);
        if (!sequences.length && (startDelay !== undefined || delay !== undefined)) return sendJson(res, 400, { error: 'Timing options need a sequence' });
        if (Number.isNaN(startDelay)) return sendJson(res, 400, { error: 'startDelay must be 0 to 60 seconds, in tenths' });
        if (Number.isNaN(delay)) return sendJson(res, 400, { error: 'delay must be 0.1 to 60 seconds, in tenths' });
        const args = actionArgs(params);
        if (typeof args === 'string') return sendJson(res, 400, { error: args });
        if (want !== undefined && (sequences.length || !steps[0].hold)) return sendJson(res, 400, { error: 'hold= is for one held action' });
        if (!sequences.length) {
          const on = playStep(steps[0], args, want);
          return sendJson(res, 202, on === undefined ? { accepted: true } : { accepted: true, on });
        }
        if (sequenceTimer) return sendJson(res, 409, { error: 'A sequence is already playing' });
        runSequence(steps, { startDelay, delay, args });
        return sendJson(res, 202, { accepted: true });
      }

      /* the editor's mic level, blinks and avatar-switch cues, passed on to the stage pages.
         JSON only: a request from another website can't send this without a CORS preflight, which is
         refused. Actions never come this way: they start at /api/streamerbot or a hotkey, which check them. */
      if (urlPath === '/api/live' && req.method === 'POST') {
        if (!/^application\/json\b/.test(req.headers['content-type'] || '')) return sendJson(res, 415, { error: 'json only' });
        let data = {};
        try { data = JSON.parse((await readBody(req)) || '{}'); } catch (e) { return sendJson(res, 400, { error: 'bad json' }); }
        if (!data || typeof data !== 'object' || Array.isArray(data) || /^action/.test(data.type)) return sendJson(res, 400, { error: 'bad message' });
        broadcast('live', data);
        res.writeHead(204); return res.end();
      }

      // the editor's hotkeys -> the desktop app registers them system-wide (see main.js)
      if (urlPath === '/api/hotkeys' && req.method === 'POST') {
        // JSON only: a request from another website can't send this without a CORS preflight, which is refused
        if (!/^application\/json\b/.test(req.headers['content-type'] || '')) return sendJson(res, 415, { error: 'json only' });
        if (!onHotkeys) return sendJson(res, 501, { error: 'global hotkeys are not available' });
        let data;
        try { data = JSON.parse(await readBody(req)); } catch (e) { return sendJson(res, 400, { error: 'bad json' }); }
        const list = data && Array.isArray(data.bindings) ? data.bindings : null;
        if (!list || list.length > 64 || !list.every(validBinding)) return sendJson(res, 400, { error: 'bad hotkeys' });
        const results = await onHotkeys(list.map((b) => ({ accelerator: b.accelerator, action: b.action })));
        return sendJson(res, 200, { results });
      }

      // the virtual camera is run by the desktop app (see main.js): GET = status, POST { on } = start / stop
      if (urlPath === '/api/vcam' && (req.method === 'GET' || req.method === 'POST')) {
        if (!onVcam) return sendJson(res, 501, { error: 'the virtual camera is not available' });
        if (req.method === 'GET') return sendJson(res, 200, await onVcam());
        if (!/^application\/json\b/.test(req.headers['content-type'] || '')) return sendJson(res, 415, { error: 'json only' });
        let data;
        try { data = JSON.parse(await readBody(req)); } catch (e) { return sendJson(res, 400, { error: 'bad json' }); }
        if (!data || typeof data.on !== 'boolean') return sendJson(res, 400, { error: 'bad request' });
        return sendJson(res, 200, await onVcam(data.on));
      }

      if (urlPath === '/api/events' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
        res.write(`retry: 1000\nevent: hello\ndata: ${JSON.stringify({ version })}\n\n`);
        // a page that arrives late (OBS reloading its source) joins the held actions that are on
        for (const msg of held.values()) res.write(`event: live\ndata: ${JSON.stringify(msg)}\n\n`);
        listeners.add(res);
        const ka = setInterval(() => { try { res.write(': keep-alive\n\n'); } catch (e) { /* closed */ } }, 15000);
        req.on('close', () => { clearInterval(ka); listeners.delete(res); });
        return;
      }

      if (req.method === 'GET') return serveStatic(req, res, urlPath);
      res.writeHead(405); res.end();
    } catch (e) {
      console.error(e);
      if (!res.headersSent) sendJson(res, 500, { error: String(e.message || e) });
      else res.end();
    }
  });

  server.on('close', () => clearTimeout(sequenceTimer));

  return new Promise((resolve, reject) => {
    let p = port;
    const attempt = () => {
      server.once('error', (err) => {
        if (err.code === 'EADDRINUSE' && p < port + tries - 1) { p++; attempt(); } else reject(err);
      });
      server.listen(p, '127.0.0.1', () => resolve({ port: p, server, broadcast, trigger, close: () => server.close() }));
    };
    attempt();
  });
}

module.exports = { start, validBinding, actionArgs };
