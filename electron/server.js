/* EASY-TUBER local server (runs inside the Electron main process).
   - Serves the app on http://localhost:<port>/ so OBS can load it as a Browser Source.
   - Keeps the avatar in a file, so OBS (which has its own browser storage) sees the same avatar.
   - Relays the editor's mic level / blinks to stage pages with Server-Sent Events.
   - Passes hotkey and virtual-camera requests from the editor on to the desktop app. */
const http = require('http');
const fs = require('fs');
const path = require('path');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.ico': 'image/x-icon', '.svg': 'image/svg+xml',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.mp4': 'video/mp4',
};
const STATIC_DIRS = ['css', 'js', 'build', 'media'];
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
    if (!Number.isFinite(a.duration) || a.duration < 100 || a.duration > 60000) return null;
    out.set(a.id, { label: typeof a.label === 'string' ? a.label.slice(0, 60) : a.id, duration: Math.round(a.duration) });
  }
  return out;
}

function start({ root, saveFile, port = 8777, tries = 10, onHotkeys = null, onVcam = null }) {
  let version = 0;
  const listeners = new Set();
  let catalog = new Map();       // actions the editor has loaded
  let sequenceTimer = null;      // a sequence step waiting to play
  let nonce = 0;

  const broadcast = (event, data) => {
    const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of listeners) { try { res.write(msg); } catch (e) { listeners.delete(res); } }
  };

  /* ---- actions ----
     A step is an action from the catalog (played by every page) or an avatar switch (done by the
     editor). Each play gets a nonce, so a page that hears it twice plays it once, and a seed, so
     random choices come out the same in the editor and in OBS. */
  const stepFor = (name) => {
    if (ACTION_ID.test(name) && catalog.has(name)) return { name, event: 'live', wait: catalog.get(name).duration };
    if (AVATAR_ACTION.test(name)) return { name, event: 'hotkey', wait: SWITCH_MS };
    return null;
  };
  const playStep = (step) => {
    if (step.event === 'hotkey') return broadcast('hotkey', { action: step.name });
    broadcast('live', {
      type: 'action', id: step.name,
      n: Date.now().toString(36) + '-' + (++nonce).toString(36), seed: Math.floor(Math.random() * 4294967296),
    });
  };
  // steps play one after another: each waits for the one before to finish, or for `delay` ms if given
  const runSequence = (steps, { startDelay = 0, delay } = {}) => {
    const next = (i, wait) => {
      if (i >= steps.length) { sequenceTimer = null; return; }
      sequenceTimer = setTimeout(() => {
        playStep(steps[i]);
        next(i + 1, delay ?? steps[i].wait);
      }, wait);
      if (sequenceTimer.unref) sequenceTimer.unref();
    };
    if (startDelay > 0) next(0, startDelay);
    else { playStep(steps[0]); next(1, delay ?? steps[0].wait); }
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
    let rel = urlPath === '/' ? 'index.html' : decodeURIComponent(urlPath.slice(1));
    rel = path.normalize(rel).replace(/^(\.\.[/\\])+/, '');
    const top = rel.split(/[/\\]/)[0];
    if (rel !== 'index.html' && !STATIC_DIRS.includes(top)) { res.writeHead(404); return res.end('Not found'); }
    const file = path.join(root, rel);
    if (!file.startsWith(root)) { res.writeHead(403); return res.end(); }
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

      // the editor says which actions it has (js/actions/*.js), so Streamer.bot requests can be checked and timed
      if (urlPath === '/api/actions' && req.method === 'POST') {
        if (!/^application\/json\b/.test(req.headers['content-type'] || '')) return sendJson(res, 415, { error: 'json only' });
        let data;
        try { data = JSON.parse(await readBody(req)); } catch (e) { return sendJson(res, 400, { error: 'bad json' }); }
        const next = parseCatalog(data && data.actions);
        if (!next) return sendJson(res, 400, { error: 'bad action list' });
        catalog = next;
        return sendJson(res, 200, { ok: true, count: catalog.size });
      }

      /* Streamer.bot (Fetch URL sub-action), or the editor's Test button:
           /api/streamerbot?action=<id>                       one action, or next / random / avatar:<id>
           /api/streamerbot?sequence=a,b,c&startDelay=1&delay=2.5   up to 8 steps, timing in seconds
         Only from this computer, and only with the header X-EasyTuber-Control: streamerbot. A web page
         can't add that header without a CORS preflight, which is refused, so websites can't trigger it. */
      if (urlPath === '/api/streamerbot' && req.method === 'GET') {
        const port = req.socket.localPort, host = req.headers.host;
        if ((host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) || req.headers['x-easytuber-control'] !== 'streamerbot') {
          return sendJson(res, 403, { error: 'Use a local URL and send the header X-EasyTuber-Control: streamerbot' });
        }
        const params = new URL(req.url, `http://127.0.0.1:${port}`).searchParams;
        const singles = params.getAll('action'), sequences = params.getAll('sequence');
        if (singles.length + sequences.length !== 1) return sendJson(res, 400, { error: 'Send one action= or one sequence=' });
        const names = sequences.length ? sequences[0].split(',').map((s) => s.trim()) : singles;
        if (!names.length || names.length > MAX_STEPS) return sendJson(res, 400, { error: `A sequence has 1 to ${MAX_STEPS} steps` });
        const steps = names.map(stepFor);
        const unknown = names.filter((n, i) => !steps[i]);
        if (unknown.length) return sendJson(res, 404, { error: 'Unknown action: ' + unknown.join(', ') + (catalog.size ? '' : ' (is the editor open?)') });
        const startDelay = seconds(params, 'startDelay', 0), delay = seconds(params, 'delay', 0.1);
        if (!sequences.length && (startDelay !== undefined || delay !== undefined)) return sendJson(res, 400, { error: 'Timing options need a sequence' });
        if (Number.isNaN(startDelay)) return sendJson(res, 400, { error: 'startDelay must be 0 to 60 seconds, in tenths' });
        if (Number.isNaN(delay)) return sendJson(res, 400, { error: 'delay must be 0.1 to 60 seconds, in tenths' });
        if (!sequences.length) { playStep(steps[0]); return sendJson(res, 202, { accepted: true }); }
        if (sequenceTimer) return sendJson(res, 409, { error: 'A sequence is already playing' });
        runSequence(steps, { startDelay, delay });
        return sendJson(res, 202, { accepted: true });
      }

      if (urlPath === '/api/live' && req.method === 'POST') {
        let data = {};
        try { data = JSON.parse((await readBody(req)) || '{}'); } catch (e) { return sendJson(res, 400, { error: 'bad json' }); }
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

module.exports = { start, validBinding };
