/* EASY-TUBER local server (runs inside the Electron main process).
   - Serves the app on http://localhost:<port>/ so OBS can load it as a Browser Source.
   - Keeps the avatar in a file, so OBS (which has its own browser storage) sees the same avatar.
   - Relays the editor's mic level / blinks to stage pages with Server-Sent Events. */
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
function validBinding(b) {
  if (!b || typeof b.accelerator !== 'string' || typeof b.action !== 'string') return false;
  if (b.accelerator.length > 64 || !/^(next|random|avatar:[\w-]{1,40})$/.test(b.action)) return false;
  const parts = b.accelerator.split('+');
  const key = parts.pop(), mods = parts;
  if (!KEY.test(key) || !mods.every((m) => MODIFIERS.has(m)) || new Set(mods).size !== mods.length) return false;
  return mods.length > 0 || SOLO_KEY.test(key);
}

function start({ root, saveFile, port = 8777, tries = 10, onHotkeys = null }) {
  let version = 0;
  const listeners = new Set();

  const broadcast = (event, data) => {
    const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of listeners) { try { res.write(msg); } catch (e) { listeners.delete(res); } }
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

  return new Promise((resolve, reject) => {
    let p = port;
    const attempt = () => {
      server.once('error', (err) => {
        if (err.code === 'EADDRINUSE' && p < port + tries - 1) { p++; attempt(); } else reject(err);
      });
      server.listen(p, '127.0.0.1', () => resolve({ port: p, server, broadcast, close: () => server.close() }));
    };
    attempt();
  });
}

module.exports = { start, validBinding };
