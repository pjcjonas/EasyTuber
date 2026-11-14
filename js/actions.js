/* Actions: your own animations, played on demand (Test button, a global hotkey, Streamer.bot).

   EASY-TUBER ships no actions. Each one is a file that calls PT.Actions.define(), in the user's
   actions folder (Actions tab -> Open actions folder) or in js/actions/. Every page loads them at
   start-up; nothing else needs editing. js/actions/README.md describes how to write one.

   A play reaches every page (editor preview, stage window, OBS) with the same nonce and seed, so
   random choices made with a.random() look the same everywhere. This file only runs and blends
   the actions; it has no animations of its own. */
(function (PT) {
  const ID = /^[\w-]{1,40}$/;
  const MIN_MS = 100, MAX_MS = 60000;
  const ZERO = { ox: 0, oy: 0, rot: 0, sx: 1, sy: 1 };

  // small, seedable random number generator: the same seed gives the same numbers on every page
  function mulberry32(seed) {
    let s = seed >>> 0;
    return () => {
      s = (s + 0x6D2B79F5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const clamp01 = (u) => Math.max(0, Math.min(1, u));

  /* the values a play came with (from the Streamer.bot URL): text only, a fixed size, never changed */
  const NO_ARGS = Object.freeze({});
  function cleanArgs(args) {
    if (!args || typeof args !== 'object' || Array.isArray(args)) return NO_ARGS;
    const out = {};
    let count = 0;
    for (const [k, v] of Object.entries(args)) {
      if (!ID.test(k) || k === '__proto__' || (typeof v !== 'string' && !Number.isFinite(v))) continue;
      if (++count > 16) break;
      out[k] = String(v).slice(0, 200);
    }
    return Object.freeze(out);
  }
  const ease = {
    linear: (u) => u,
    inQuad: (u) => u * u,
    outQuad: (u) => 1 - (1 - u) * (1 - u),
    inOut: (u) => (u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2),
    outBack: (u) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(u - 1, 3) + c1 * Math.pow(u - 1, 2); },
    outElastic: (u) => (u === 0 || u === 1 ? u : Math.pow(2, -10 * u) * Math.sin((u * 10 - 0.75) * (2 * Math.PI / 3)) + 1),
    // 0 -> 1 -> 0 over the run
    bell: (u) => Math.sin(Math.PI * clamp01(u)),
  };

  // one setting from def.settings, checked and filled in
  function cleanSetting(s) {
    if (!s || typeof s.key !== 'string' || !ID.test(s.key)) return null;
    const label = typeof s.label === 'string' && s.label ? s.label : s.key;
    if (s.type === 'check') return { key: s.key, label, type: 'check', default: !!s.default };
    const min = Number.isFinite(s.min) ? s.min : 0, max = Number.isFinite(s.max) ? s.max : 100;
    const step = Number.isFinite(s.step) && s.step > 0 ? s.step : 1;
    const def = Number.isFinite(s.default) ? Math.max(min, Math.min(max, s.default)) : min;
    return { key: s.key, label, type: 'range', min, max, step, default: def, suffix: typeof s.suffix === 'string' ? s.suffix : '' };
  }

  const images = new Map();

  const Actions = {
    MIN_MS, MAX_MS, ease, mulberry32,
    defs: new Map(),        // id -> definition, in the order the files were loaded
    defined: 0,             // how many define() calls worked (loadAll checks that a file made one)
    running: [],            // [{ def, t0, n, seed, settings, state, random }]
    seen: [],               // nonces already played (a play can arrive by two routes)
    pose: null, view: null, // this frame's pose, for a.at()
    onError: null,          // (def, error) -> void, set by the editor to show a toast

    /* ---------- defining ---------- */
    define(def) {
      if (!def || typeof def.id !== 'string' || !ID.test(def.id)) throw new Error('Action id must be 1-40 letters, digits, - or _');
      if (!Number.isFinite(def.duration) || def.duration < MIN_MS || def.duration > MAX_MS) {
        throw new Error(`Action "${def.id}": duration must be ${MIN_MS} to ${MAX_MS} ms`);
      }
      const clean = {
        ...def,
        label: typeof def.label === 'string' && def.label ? def.label.slice(0, 60) : def.id,
        duration: Math.round(def.duration),
        settings: (Array.isArray(def.settings) ? def.settings : []).map(cleanSetting).filter(Boolean),
      };
      this.defs.set(def.id, clean);
      this.defined++;
      return clean;
    },
    get(id) { return this.defs.get(id) || null; },
    list() { return [...this.defs.values()]; },
    // what the server needs to check and time Streamer.bot requests
    catalog() { return this.list().map(({ id, label, duration }) => ({ id, label, duration })); },

    /* Load every action file the server lists: the app's js/actions/ first, then the user's actions
       folder, so a user file can replace one of the app's. files = [{ src, from }].
       Returns { loaded, failed: [{ src, message }] }. A file that fails is skipped; the rest still load. */
    async loadAll(files, doc = document, win = window) {
      const failed = [];
      let loaded = 0;
      for (const f of files || []) {
        if (!f || typeof f.src !== 'string') continue;
        const before = this.defined;
        const message = await new Promise((resolve) => {
          // an error thrown while the file runs (a typo, a bad define()) arrives here, not on the tag
          let thrown = '';
          const onError = (e) => { if (!e.filename || e.filename.includes(f.src)) thrown = e.message || 'error'; };
          win.addEventListener('error', onError);
          const done = (m) => { win.removeEventListener('error', onError); resolve(m); };
          const tag = doc.createElement('script');
          tag.src = f.src;
          tag.onload = () => done(thrown);
          tag.onerror = () => done('could not be read');
          doc.head.appendChild(tag);
        });
        if (message) failed.push({ src: f.src, message });
        else if (this.defined === before) failed.push({ src: f.src, message: 'has no PT.Actions.define()' });
        else loaded++;
      }
      return { loaded, failed };
    },

    /* the saved settings for an action, with defaults for anything missing and values kept in range */
    settingsFor(project, def) {
      const saved = (project && project.actions && project.actions[def.id] && project.actions[def.id].settings) || {};
      const out = {};
      for (const s of def.settings) {
        const v = saved[s.key];
        if (s.type === 'check') out[s.key] = typeof v === 'boolean' ? v : s.default;
        else out[s.key] = Number.isFinite(v) ? Math.max(s.min, Math.min(s.max, v)) : s.default;
      }
      return out;
    },

    /* cached image for actions that draw pictures: null until it has loaded */
    image(src) {
      let e = images.get(src);
      if (!e) {
        e = { img: null };
        images.set(src, e);
        PT.loadImage(src).then((img) => { e.img = img; }, () => console.warn('Action image not found: ' + src));
      }
      return e.img;
    },

    /* ---------- playing ---------- */
    newPlay(id, args = null) {
      const msg = { type: 'action', id, n: Date.now().toString(36) + Math.random().toString(36).slice(2, 8), seed: (Math.random() * 4294967296) >>> 0 };
      if (args) msg.args = args;
      return msg;
    },

    /* Start an action on this page. msg = { n, seed, args } from the server or newPlay().
       Returns false when the action isn't defined here. */
    play(id, msg = {}, project = PT.App && PT.App.project, now = performance.now()) {
      const def = this.defs.get(id);
      if (!def) return false;
      if (msg.n) {
        if (this.seen.includes(msg.n)) return true;
        this.seen.push(msg.n);
        if (this.seen.length > 50) this.seen.shift();
      }
      // a second play of the same action restarts it, unless it allows copies to overlap
      if (!def.overlap) this.running = this.running.filter((r) => r.def !== def);
      const seed = Number.isFinite(msg.seed) ? msg.seed : (Math.random() * 4294967296) >>> 0;
      const run = { def, t0: now, n: msg.n || null, seed, args: cleanArgs(msg.args), settings: this.settingsFor(project, def), state: {}, random: mulberry32(seed) };
      this.running.push(run);
      this.call(run, 'start', now, project);
      return true;
    },

    stop(id) {
      for (const r of this.running) if (!id || r.def.id === id) this.call(r, 'end', performance.now());
      this.running = id ? this.running.filter((r) => r.def.id !== id) : [];
    },

    get active() { return this.running.length > 0; },

    /* the object every hook receives */
    ctx(run, now, project) {
      const ms = Math.max(0, now - run.t0), d = run.def.duration;
      const self = this;
      return {
        id: run.def.id, ms, duration: d, t: clamp01(ms / d),
        settings: run.settings, state: run.state, random: run.random, seed: run.seed, args: run.args,
        project: project || (PT.App && PT.App.project), ease,
        // 0 -> 1 over the first inMs, 1 -> 0 over the last outMs: blends the action in and out
        envelope(inMs = 150, outMs = 250) {
          const a = inMs > 0 ? clamp01(ms / inMs) : 1, b = outMs > 0 ? clamp01((d - ms) / outMs) : 1;
          return Math.min(a, b);
        },
        // progress through a slice of the run: a.between(0.2, 0.6) is 0 before 20 %, 1 after 60 %
        between(from, to) { return clamp01((ms / d - from) / Math.max(1e-6, to - from)); },
        // where a point on a part is right now, in stage units. u, v = 0..1 across the part's image
        at(partId, u = 0.5, v = 0.5) { return self.partPoint(partId, u, v); },
        image: (src) => self.image(src),
      };
    },

    /* run one hook, and stop the action if it throws (a bad action must not freeze the avatar) */
    call(run, hook, now, project, ...args) {
      const fn = run.def[hook];
      if (typeof fn !== 'function') return undefined;
      try { return fn.call(run.def, this.ctx(run, now, project), ...args); } catch (e) {
        console.error(`Action "${run.def.id}" failed in ${hook}():`, e);
        this.running = this.running.filter((r) => r !== run);
        if (this.onError) this.onError(run.def, e);
        return undefined;
      }
    },

    /* Once per frame, before the pose is built. Ends finished runs and returns
       { deltas: extra motion per part, states: eyes/mouth overrides }, or null when nothing plays. */
    update(now, project) {
      for (const r of this.running.slice()) {
        if (now - r.t0 >= r.def.duration) {
          this.running = this.running.filter((x) => x !== r);
          this.call(r, 'end', now, project);
        }
      }
      if (!this.running.length) return null;
      const deltas = {}, states = {};
      for (const r of this.running.slice()) {
        const d = this.call(r, 'pose', now, project);
        if (d && typeof d === 'object') {
          for (const [id, v] of Object.entries(d)) {
            if (!PT.PART[id] || !v) continue;
            const acc = deltas[id] || (deltas[id] = { ...ZERO });
            acc.ox += +v.ox || 0; acc.oy += +v.oy || 0; acc.rot += +v.rot || 0;
            if (Number.isFinite(v.sx)) acc.sx *= v.sx;
            if (Number.isFinite(v.sy)) acc.sy *= v.sy;
            if (Number.isFinite(v.scale)) { acc.sx *= v.scale; acc.sy *= v.scale; }
          }
        }
        const s = this.call(r, 'states', now, project);
        if (s && typeof s === 'object') Object.assign(states, s);
      }
      this.now = now;
      this.project = project;
      return { deltas, states };
    },

    /* the idle motion plus every running action's motion (offsets add, scales multiply) */
    mergeDeltas(base, extra) {
      if (!extra) return base;
      const out = { ...(base || {}) };
      for (const [id, e] of Object.entries(extra)) {
        const b = out[id] || ZERO;
        out[id] = { ox: b.ox + e.ox, oy: b.oy + e.oy, rot: b.rot + e.rot, sx: b.sx * e.sx, sy: b.sy * e.sy };
      }
      return out;
    },

    /* after the pose is built: lets a.at() find parts */
    setPose(pose, renderer) { this.pose = pose; this.view = renderer.view(); },

    partPoint(partId, u, v) {
      const pose = this.pose, part = pose && pose[partId];
      if (!part || !this.view) return [PT.STAGE_W / 2, PT.STAGE_H / 2];
      const e = PT.Assets.primary(partId, this.project && this.project.stage.placeholders);
      const w = e ? e.w : 0, h = e ? e.h : 0;
      const [cx, cy] = PT.M.apply(part.world, u * w, v * h);
      return PT.M.apply(PT.M.inv(this.view), cx, cy);
    },

    /* per-part screen-space offsets for the renderer: { dx, dy, rot, scale, alpha, hide } or null */
    partFx(id) {
      let out = null;
      for (const r of this.running.slice()) {
        if (typeof r.def.parts !== 'function') continue;
        const f = this.call(r, 'parts', this.now, this.project, id);
        if (!f) continue;
        out = out || { dx: 0, dy: 0, rot: 0, scale: 1, alpha: 1, hide: false };
        out.dx += +f.dx || 0; out.dy += +f.dy || 0; out.rot += +f.rot || 0;
        if (Number.isFinite(f.scale)) out.scale *= f.scale;
        if (Number.isFinite(f.alpha)) out.alpha *= Math.max(0, Math.min(1, f.alpha));
        if (f.hide) out.hide = true;
      }
      return out;
    },
    get hasPartFx() { return this.running.some((r) => typeof r.def.parts === 'function'); },

    /* drawing hooks: layer = 'behind' (before the avatar) or 'front' (after it).
       The canvas is set to stage units: (0, 0) top-left, PT.STAGE_W x PT.STAGE_H. */
    draw(layer, renderer) {
      const g = renderer.ctx;
      for (const r of this.running.slice()) {
        if (typeof r.def[layer] !== 'function') continue;
        const v = renderer.view();
        g.save();
        g.setTransform(v[0], v[1], v[2], v[3], v[4], v[5]);
        this.call(r, layer, this.now, this.project, g);
        g.restore();
      }
    },
  };

  /* two offsets from the switch animation and an action, combined */
  Actions.combineFx = (a, b) => {
    if (!a) return b;
    if (!b) return a;
    return {
      dx: (a.dx || 0) + (b.dx || 0), dy: (a.dy || 0) + (b.dy || 0), rot: (a.rot || 0) + (b.rot || 0),
      scale: (a.scale ?? 1) * (b.scale ?? 1), alpha: (a.alpha ?? 1) * (b.alpha ?? 1), hide: !!(a.hide || b.hide),
    };
  };

  PT.Actions = Actions;
})(window.PT);
