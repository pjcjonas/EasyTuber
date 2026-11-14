/* Persistence.
   - The project is saved in IndexedDB (this browser only) AND, in the desktop app, in
     avatar.easytuber.json in the app-data folder. The file is what lets OBS's Browser Source
     (which has its own, empty browser storage) show your avatar.
   - In the desktop app the pictures are not in the project: each one is a file in the images
     folder beside the avatar file, and the project says "img:<sha-256 of the picture>". So a save
     is small however much art there is. Without the app (browser only) pictures stay in the
     project as data URLs. "Save file" always writes one file with the pictures inside.
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

    /* ---- pictures as files (desktop app) ---- */
    _refs: new Map(),   // data URL -> "img:<hash>", for pictures already stored this session
    _storeWarned: false,

    // every place in a project that holds a picture: [object, key] pairs
    pictureSlots(project) {
      const slots = [];
      const look = (l) => {
        if (!l || typeof l !== 'object') return;
        for (const part of Object.values(l.parts || {})) for (const st of Object.keys((part && part.images) || {})) slots.push([part.images, st]);
        for (const sheet of Array.isArray(l.sheets) ? l.sheets : []) if (sheet) slots.push([sheet, 'url']);
      };
      look(project);
      for (const a of (project && project.avatars) || []) look(a && a.look);
      return slots;
    },

    // store one picture with the app; returns its "img:<hash>", or null if that didn't work
    async storePicture(dataUrl) {
      if (this._refs.has(dataUrl)) return this._refs.get(dataUrl);
      const bytes = await (await fetch(dataUrl)).arrayBuffer();
      const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
      const hash = Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('');
      const r = await fetch('api/image/' + hash, { method: 'PUT', body: bytes });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'server said ' + r.status);
      const ref = 'img:' + hash;
      this._refs.set(dataUrl, ref);
      PT.Assets.aliases.set(ref, dataUrl);
      return ref;
    },

    /* Move every picture that is still inside the project (a new upload, a crop, an opened file)
       out to the app's images folder, leaving "img:<hash>" in its place. A picture that can't be
       stored stays in the project, so nothing is lost. Returns how many were moved. */
    async externalize(project) {
      if (!this.server || !window.crypto || !crypto.subtle) return 0;
      let moved = 0;
      for (const [obj, key] of this.pictureSlots(project)) {
        const url = obj[key];
        if (typeof url !== 'string' || !url.startsWith('data:image/')) continue;
        try {
          const ref = await this.storePicture(url);
          if (obj[key] === url) { obj[key] = ref; moved++; }   // unless it changed while we waited
        } catch (e) {
          console.warn(e);
          if (!this._storeWarned) {
            this._storeWarned = true;
            PT.toast('Could not store a picture as a file: ' + e.message + '. It is kept inside the avatar file instead.', 'warn', 8000);
          }
        }
      }
      return moved;
    },

    /* A copy of the project with every picture inside it again, as "Save file" writes it: one
       file that opens on any computer. Throws if a picture can't be read. */
    async inlined(project) {
      const copy = PT.deepClone(project);
      const cache = new Map();
      const read = async (ref) => {
        if (!cache.has(ref)) {
          cache.set(ref, (async () => {
            const r = await fetch(PT.imageSrc(ref));
            if (!r.ok) throw new Error('a picture is missing from the images folder');
            return PT.readFileAsDataURL(await r.blob());
          })());
        }
        return cache.get(ref);
      };
      for (const [obj, key] of this.pictureSlots(copy)) if (PT.isImageRef(obj[key])) obj[key] = await read(obj[key]);
      return copy;
    },

    /* How many of a project's pictures are files this app doesn't have. A file made with "Save file"
       has its pictures inside it, so this is 0; the app's own working copy from another computer
       has only their names. */
    async missingPictures(project) {
      const refs = new Set(this.pictureSlots(project).map(([obj, key]) => obj[key]).filter(PT.isImageRef));
      let missing = 0;
      for (const ref of refs) {
        let ok = false;
        try { ok = this.server && (await fetch(PT.imageSrc(ref), { method: 'GET' })).ok; } catch (e) { ok = false; }
        if (!ok) missing++;
      }
      return missing;
    },

    async save(project) {
      await this.externalize(project);
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
      fetch('api/live', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(msg), keepalive: true }).catch(() => {});
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
    /* Virtual camera (desktop app only). on = true / false to start / stop, nothing to ask.
       Returns { on, device, error }, or null where there is no camera. */
    async vcam(on) {
      if (!this.server) return null;
      try {
        const opts = on === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ on }) };
        const r = await fetch('api/vcam', opts);
        return r.ok ? await r.json() : null;
      } catch (e) { return null; }
    },

    /* Actions (desktop app only): tell the server which actions exist, so Streamer.bot requests can be
       checked and timed. actions = [{ id, label, duration }] */
    async setActions(actions, sequences = []) {
      if (!this.server) return false;
      try {
        const r = await fetch('api/actions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ actions, sequences }) });
        return r.ok;
      } catch (e) { return false; }
    },
    /* The action files to load: { files: [{ src, from: 'app' | 'user' }], folder }. Empty without the server. */
    async actionFiles() {
      if (!this.server) return { files: [], folder: '' };
      try {
        const r = await fetchTimeout('api/action-files', {}, 5000);
        const data = r.ok ? await r.json() : null;
        return { files: data && Array.isArray(data.files) ? data.files : [], folder: (data && data.folder) || '' };
      } catch (e) { console.warn(e); return { files: [], folder: '' }; }
    },
    /* Show the user's actions folder in the file manager (desktop app only). Throws with the reason. */
    async openActionsFolder() {
      const r = await fetch('api/open-folder', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ folder: 'actions' }) });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'server said ' + r.status);
    },
    /* Play a Streamer.bot URL exactly as Streamer.bot would. Throws with the server's reason. */
    async runActionUrl(url) {
      const r = await fetch(url, { headers: { 'X-EasyTuber-Control': 'streamerbot' } });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'server said ' + r.status);
    },
    // the server's live messages (actions, mic level, ...), for the editor; stage pages use onMessage
    onLive(fn) {
      const es = this.events();
      if (es) es.addEventListener('live', (e) => { try { fn(JSON.parse(e.data)); } catch (err) { /* ignore */ } });
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
