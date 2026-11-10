/* Persistence.
   - The whole project (including images as data URLs) is saved in IndexedDB (this browser only)
     AND, in the desktop app, in avatar.easytuber.json in the app-data folder.
     The file is what lets OBS's Browser Source (which has its own, empty browser storage)
     show your avatar.
   - Live messages (mic level, blink, "project changed") reach stage pages through a
     BroadcastChannel (same browser) and through the server's event stream (any browser, OBS). */
(function (PT) {
  const DB = 'easy-tuber', STORE = 'kv', KEY = 'project';
  let dbp = null;

  function openDB(name) {
    return new Promise((res, rej) => {
      const req = indexedDB.open(name, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error);
    });
  }
  function db() { return dbp || (dbp = openDB(DB)); }

  // avatars saved before the rename live in the old 'pngtuber-rig' database
  async function loadLegacy() {
    try {
      if (indexedDB.databases && !(await indexedDB.databases()).some((d) => d.name === 'pngtuber-rig')) return null;
      const d = await openDB('pngtuber-rig');
      return await new Promise((res) => {
        const r = d.transaction(STORE, 'readonly').objectStore(STORE).get(KEY);
        r.onsuccess = () => { res(r.result || null); d.close(); };
        r.onerror = () => { res(null); d.close(); };
      });
    } catch (e) { return null; }
  }

  async function tx(mode, fn) {
    const d = await db();
    return new Promise((res, rej) => {
      const t = d.transaction(STORE, mode);
      const r = fn(t.objectStore(STORE));
      t.oncomplete = () => res(r && r.result);
      t.onerror = () => rej(t.error);
    });
  }

  async function fetchTimeout(url, opts = {}, ms = 1500) {
    const ctl = new AbortController();
    const id = setTimeout(() => ctl.abort(), ms);
    try { return await fetch(url, { ...opts, signal: ctl.signal }); } finally { clearTimeout(id); }
  }

  let channel = null;
  try { channel = new BroadcastChannel('easy-tuber'); } catch (e) { /* unsupported */ }

  PT.Storage = {
    server: false,           // true when served by server.py
    _putBusy: false, _putNext: null, _putWarned: false,
    _liveLast: 0,

    async init() {
      if (location.protocol === 'file:') return;
      try {
        const r = await fetchTimeout('api/ping');
        this.server = r.ok && (await r.json()).ok === true;
      } catch (e) { this.server = false; }
    },

    async loadServer() {
      if (!this.server) return null;
      try {
        const r = await fetchTimeout('api/project', {}, 10000);
        return r.ok ? await r.json() : null;
      } catch (e) { console.warn(e); return null; }
    },
    async loadLocal() {
      try { return (await tx('readonly', (s) => s.get(KEY))) || (await loadLegacy()); } catch (e) { console.warn(e); return null; }
    },

    /* Returns { project, pushToServer }.  The newer of the file and this browser's copy wins. */
    async load() {
      const [srv, loc] = await Promise.all([this.loadServer(), this.loadLocal()]);
      const at = (p) => (p && p.savedAt) || 0;
      if (srv && (!loc || at(srv) >= at(loc))) return { project: srv, pushToServer: false };
      return { project: loc, pushToServer: !!(loc && this.server) };
    },

    async save(project) {
      project.savedAt = Date.now();
      try {
        await tx('readwrite', (s) => s.put(project, KEY));
      } catch (e) {
        console.warn(e);
        if (!this.server) PT.toast('Could not save to browser storage: ' + e.message, 'error');
      }
      this.post({ type: 'project-saved' });
      if (this.server) this.putServer(JSON.stringify(project));
    },

    // one upload at a time; if more saves arrive meanwhile only the latest is sent
    async putServer(body) {
      if (this._putBusy) { this._putNext = body; return; }
      this._putBusy = true;
      try {
        const r = await fetch('api/project', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body });
        if (!r.ok) throw new Error('server said ' + r.status);
        this._putWarned = false;
      } catch (e) {
        console.warn(e);
        if (!this._putWarned) {
          this._putWarned = true;
          PT.toast('Could not save the avatar file for OBS. Try restarting EASY-TUBER.', 'error', 7000);
        }
      }
      this._putBusy = false;
      if (this._putNext) { const next = this._putNext; this._putNext = null; this.putServer(next); }
    },

    async clear() { try { await tx('readwrite', (s) => s.delete(KEY)); this.post({ type: 'project-saved' }); } catch (e) { /* ignore */ } },

    post(msg) { if (channel) try { channel.postMessage(msg); } catch (e) { /* ignore */ } },

    /* Mic level / blink for stage pages. Level updates are capped at ~30 per second. */
    live(msg) {
      this.post(msg);
      if (!this.server) return;
      const now = performance.now();
      if (msg.type === 'level') {
        if (now - this._liveLast < 33) return;
        this._liveLast = now;
      }
      fetch('api/live', { method: 'POST', body: JSON.stringify(msg), keepalive: true }).catch(() => {});
    },

    // one event stream per page, shared by onMessage and onHotkey
    events() {
      if (!this._es && this.server && window.EventSource) this._es = new EventSource('api/events');
      return this._es || null;
    },

    /* Global hotkeys (desktop app only): the main process registers them with the system.
       Returns [{ accelerator, ok }], or null where global hotkeys aren't available. */
    async setHotkeys(bindings) {
      if (!this.server) return null;
      try {
        const r = await fetch('api/hotkeys', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ bindings }) });
        if (!r.ok) return null;
        return (await r.json()).results || null;
      } catch (e) { return null; }
    },
    onHotkey(fn) {
      const es = this.events();
      if (es) es.addEventListener('hotkey', (e) => { try { fn(JSON.parse(e.data).action); } catch (err) { /* ignore */ } });
    },

    onMessage(fn) {
      if (channel) channel.addEventListener('message', (e) => fn(e.data));
      const es = this.events();
      if (!es) return;
      let first = true;
      es.addEventListener('hello', () => {
        // reconnected after the server restarted: re-read the avatar in case it changed
        if (!first) fn({ type: 'project-saved' });
        first = false;
      });
      es.addEventListener('project', () => fn({ type: 'project-saved' }));
      es.addEventListener('live', (e) => { try { fn(JSON.parse(e.data)); } catch (err) { /* ignore */ } });
    },
  };
})(window.PT);
