/* Avatar layouts: several looks in one project, switched by global hotkeys, plus a random mix.

   The active avatar's look lives in project.parts / order / root / sheets, so the editor, the
   renderer and the OBS page work on it unchanged. Every other avatar keeps its look in
   project.avatars[i].look. Switching moves the current look into its avatar and the new one out.
   activeAvatar === 'random' means the look on screen is a random mix that belongs to no avatar. */
(function (PT) {
  const RANDOM = 'random';

  // parts that must come from the same avatar, or joints won't meet (an upper arm with another
  // avatar's forearm, say)
  const BASE_GROUPS = [['torso'], ['neck'], ['face'], ['eyes'], ['mouth'], ['hairFront'], ['hairBack'],
    ['armLUpper', 'armLLower'], ['armRUpper', 'armRLower']];
  // each of the user's own parts is a group by itself
  const mixGroups = () => [...BASE_GROUPS, ...PT.PARTS.filter((d) => d.custom).map((d) => [d.id])];

  const clone = (o) => (typeof structuredClone === 'function' ? structuredClone(o) : JSON.parse(JSON.stringify(o)));
  const uid = () => 'a' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const hasArt = (look, id) => !!(look && look.parts && look.parts[id] && Object.values(look.parts[id].images || {}).some(Boolean));

  /* ---------------- keyboard -> Electron accelerator ---------------- */
  const CODE_KEYS = {
    NumpadAdd: 'numadd', NumpadSubtract: 'numsub', NumpadMultiply: 'nummult', NumpadDivide: 'numdiv', NumpadDecimal: 'numdec',
    ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right', Space: 'Space',
    Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown', Insert: 'Insert', Delete: 'Delete',
    Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Semicolon: ';', Quote: "'",
    Comma: ',', Period: '.', Slash: '/', Backslash: '\\', Backquote: '`',
  };
  // keys that may be bound on their own; anything else needs a modifier, or it would stop working
  // in every other program (a bare "A" would never reach your games or chat)
  const SOLO_OK = /^(F([1-9]|1\d|2[0-4])|num(\d|add|sub|mult|div|dec))$/;

  function keyFromEvent(e) {
    const c = e.code || '';
    if (/^Key[A-Z]$/.test(c)) return c.slice(3);
    if (/^Digit\d$/.test(c)) return c.slice(5);
    if (/^Numpad\d$/.test(c)) return 'num' + c.slice(6);
    if (/^F([1-9]|1\d|2[0-4])$/.test(c)) return c;
    return CODE_KEYS[c] || null;
  }

  /* Returns { accelerator } for a usable combination, { error } for one that can't be bound,
     or null while only modifiers are held. */
  function acceleratorFromEvent(e, isMac = /Mac/.test(navigator.platform)) {
    const key = keyFromEvent(e);
    if (!key) return /^(Control|Shift|Alt|Meta|AltGraph|OS)$/.test(e.key) ? null : { error: 'That key can\'t be used as a hotkey.' };
    const mods = [];
    if (e.ctrlKey) mods.push('Ctrl');
    if (e.altKey) mods.push('Alt');
    if (e.shiftKey) mods.push('Shift');
    if (e.metaKey) mods.push(isMac ? 'Cmd' : 'Super');
    if (!mods.length && !SOLO_OK.test(key)) return { error: 'Add Ctrl, Alt or Shift, so the key still works in your other programs. F-keys and numpad keys can be used on their own.' };
    return { accelerator: [...mods, key].join('+') };
  }

  const prettyKey = (acc) => (acc ? acc.replace(/num(\w+)/, (_, k) => 'Num ' + ({ add: '+', sub: '−', mult: '×', div: '÷', dec: '.' }[k] || k)).split('+').join(' + ') : '');

  /* ---------------- looks ---------------- */
  function takeLook(project) {
    const look = {};
    for (const k of PT.LOOK_KEYS) look[k] = project[k];
    return look;
  }
  function putLook(project, look) {
    const n = PT.normalizeProject({ ...(look || {}) }, true);   // a look: the skeleton stays as it is
    for (const k of PT.LOOK_KEYS) project[k] = n[k];
  }
  function blankLook() { const d = PT.defaultProject(); return takeLook(d); }

  // what a group is called in lists: "Left arm" for the two arm pieces, else the part's name
  const groupLabel = (group) => { const d = PT.PART[group[0]]; return group.length > 1 ? d.group : d.label; };
  // one group's parts, copied from a look (a look from before a part existed gives an empty part)
  const groupParts = (look, group) => Object.fromEntries(group.map((id) => [id, look.parts[id] ? clone(look.parts[id]) : PT.defaultPart(id)]));

  /* A look put together from chosen avatars: picks[i] = which of looks group i comes from.
     base = whose draw order and placement of the whole character to keep. Deep copies. */
  function compose(looks, picks, base = looks[0]) {
    const look = { parts: {}, order: clone(base.order), root: clone(base.root), sheets: [] };
    mixGroups().forEach((group, i) => Object.assign(look.parts, groupParts(looks[picks[i]] || looks[0], group)));
    return look;
  }

  /* A random mix: each part group comes from a random avatar that has art for it.
     looks = the avatars' looks; rng = () => [0, 1); base as in compose.
     Returns { look, picks: the index into looks each group came from }. */
  function mix(looks, rng = Math.random, base = looks[0]) {
    const picks = mixGroups().map((group) => {
      const withArt = looks.filter((l) => hasArt(l, group[0]));
      const pool = withArt.length ? withArt : looks;
      return looks.indexOf(pool[Math.floor(rng() * pool.length) % pool.length]);
    });
    return { look: compose(looks, picks, base), picks };
  }

  /* ---------------- the controller (editor window) ---------------- */
  const Avatars = {
    RANDOM, mixGroups,
    get MIX_GROUPS() { return mixGroups(); },
    acceleratorFromEvent, prettyKey, takeLook, putLook, blankLook, mix, compose, hasArt, groupLabel,
    status: {},          // accelerator -> registered with the system?
    supported: false,    // global hotkeys available (the desktop app)
    busy: false, queued: null,

    get app() { return PT.App; },
    get project() { return PT.App.project; },

    list() { return this.project.avatars; },
    active() { return this.project.avatars.find((a) => a.id === this.project.activeAvatar) || null; },
    activeName() { const a = this.active(); return a ? a.name : 'Random mix'; },
    // every avatar's look, the active one's from the project itself
    looks() { return this.list().map((a) => (a.look ? a.look : a.id === this.project.activeAvatar ? takeLook(this.project) : blankLook())); },

    /* ---- global hotkeys ---- */
    bindings() {
      const p = this.project, out = [];
      for (const a of p.avatars) if (a.hotkey) out.push({ accelerator: a.hotkey, action: 'avatar:' + a.id });
      if (p.hotkeys.next) out.push({ accelerator: p.hotkeys.next, action: 'next' });
      if (p.hotkeys.random) out.push({ accelerator: p.hotkeys.random, action: 'random' });
      // actions: only the ones whose file is loaded
      for (const [id, a] of Object.entries(p.actions || {})) {
        if (a.hotkey && PT.Actions && PT.Actions.get(id)) out.push({ accelerator: a.hotkey, action: 'action:' + id });
      }
      for (const s of p.sequences || []) if (s.hotkey) out.push({ accelerator: s.hotkey, action: 'sequence:' + s.id });
      return out;
    },
    async register(bindings = this.bindings()) {
      const res = await PT.Storage.setHotkeys(bindings);
      this.supported = !!res;
      this.status = {};
      if (res) for (const r of res) this.status[r.accelerator] = r.ok;
      if (PT.Panels.renderAvatars) PT.Panels.renderAvatars();
      if (PT.Panels.renderActions) PT.Panels.renderActions();
      return res;
    },
    pause() { return PT.Storage.setHotkeys([]); },   // while capturing a new key
    // except = what is being set: an avatar, 'next', 'random' or 'action:<id>'
    keyInUse(acc, except) {
      const p = this.project;
      if (p.avatars.some((a) => a.hotkey === acc && a !== except)) return true;
      if (Object.entries(p.actions || {}).some(([id, a]) => a.hotkey === acc && except !== 'action:' + id)) return true;
      if ((p.sequences || []).some((s) => s.hotkey === acc && except !== 'sequence:' + s.id)) return true;
      return ['next', 'random'].some((k) => k !== except && p.hotkeys[k] === acc);
    },

    handle(action) {
      if (action === 'next' || action === RANDOM) return this.switchTo(action);
      if (action.startsWith('avatar:')) return this.switchTo(action.slice(7));
      if (action.startsWith('action:')) return PT.App.playAction(action.slice(7));
    },

    /* ---- switching ---- */
    async switchTo(target, { animate = this.project.switchFx, toast = true } = {}) {
      if (this.busy) { this.queued = target; return; }
      const p = this.project;
      let id = target;
      if (target === 'next') {
        const list = p.avatars, i = list.findIndex((a) => a.id === p.activeAvatar);
        if (list.length < 2 && i >= 0) return;
        id = list[(i + 1) % list.length].id;
      }
      if (id !== RANDOM) {
        if (!p.avatars.some((a) => a.id === id)) return;
        if (id === p.activeAvatar) return;
      } else if (p.avatars.length < 2) {
        if (toast) PT.toast('Add a second avatar to mix them. Random mix takes each part from a different avatar.', 'warn', 6000);
        return;
      }

      this.busy = true;
      try {
        if (animate) {
          PT.Transition.out();
          PT.Storage.live({ type: 'switch-out' });
          await new Promise((r) => setTimeout(r, PT.Transition.OUT_MS));
        }
        let look;
        if (id === RANDOM) {
          const avatarLooks = this.looks(), base = this.active() ? takeLook(p) : avatarLooks[0];
          const same = (a, b) => !!b && a.join() === b.join();
          let m;
          for (let tries = 0; tries < 8; tries++) {      // try not to land on the mix that's showing
            m = mix(avatarLooks, Math.random, base);
            const whole = m.picks.every((x) => x === m.picks[0]);   // all from one avatar: not much of a mix
            if (!same(m.picks, this.lastPicks) && !whole) break;
          }
          look = m.look;
          this.lastPicks = m.picks;
          p.mix = Object.fromEntries(mixGroups().map((g, i) => [g[0], p.avatars[m.picks[i]].id]));
        } else p.mix = null;
        const cur = this.active();
        if (cur) cur.look = takeLook(p);                // a random mix on screen is simply dropped
        if (id !== RANDOM) { const next = p.avatars.find((a) => a.id === id); look = next.look || blankLook(); next.look = null; }
        putLook(p, look);
        p.activeAvatar = id;
        await PT.Assets.loadProject(p);
        this.app.afterLookChange();
        PT.Storage.save(p);                              // now, not debounced: OBS is waiting for it
        if (animate) PT.Transition.in();
        if (toast) PT.toast((id === RANDOM ? '🎲 ' : '') + this.activeName());
      } finally {
        this.busy = false;
      }
      if (this.queued) { const q = this.queued; this.queued = null; this.switchTo(q); }
    },

    /* ---- building a mix by hand, and copying one part between avatars ---- */
    groupOf(partId) { return mixGroups().find((g) => g.includes(partId)) || null; },
    // which avatar a group on screen came from: the avatar itself, or what the mix says ('' = not known)
    sourceOf(group) {
      const p = this.project;
      const id = p.activeAvatar !== RANDOM ? p.activeAvatar : (p.mix && p.mix[group[0]]) || '';
      return p.avatars.some((a) => a.id === id) ? id : '';   // an avatar deleted since: not known any more
    },

    /* Take one group (a part; both pieces of an arm) from an avatar and show the result.
       From an avatar this starts a mix: the avatar itself is left as it was, and the mix on screen
       belongs to no avatar until "Keep this mix". In a mix it changes that one group. */
    async buildMix(partId, avatarId) {
      const p = this.project, group = this.groupOf(partId), src = p.avatars.find((a) => a.id === avatarId);
      if (!group || !src || this.busy) return false;
      if (p.avatars.length < 2) { PT.toast('Add a second avatar to mix them.', 'warn', 5000); return false; }
      this.busy = true;
      try {
        const cur = this.active();
        if (cur) {
          // the avatar keeps its look; what is on screen becomes a copy of it
          cur.look = takeLook(p);
          putLook(p, clone(cur.look));
          p.mix = Object.fromEntries(mixGroups().map((g) => [g[0], cur.id]));
          p.activeAvatar = RANDOM;
        }
        Object.assign(p.parts, groupParts(src.look || blankLook(), group));
        p.mix = { ...(p.mix || {}), [group[0]]: src.id };
        await PT.Assets.loadProject(p);
        this.app.afterLookChange();
        PT.Storage.save(p);
      } finally { this.busy = false; }
      return true;
    },

    /* Replace one group of the avatar on screen with another avatar's, for good. */
    async copyGroup(partId, avatarId) {
      const p = this.project, group = this.groupOf(partId), src = p.avatars.find((a) => a.id === avatarId);
      if (!group || !src || !src.look || this.busy) return false;
      if (p.activeAvatar === RANDOM) return this.buildMix(partId, avatarId);
      this.busy = true;
      try {
        Object.assign(p.parts, groupParts(src.look, group));
        await PT.Assets.loadProject(p);
        PT.Editor.resetHistory();
        this.app.changed({ structure: true });
      } finally { this.busy = false; }
      return true;
    },

    /* ---- managing the list ---- */
    add(name, look) {
      const p = this.project;
      const a = { id: uid(), name: (name || `Avatar ${p.avatars.length + 1}`).slice(0, 60), hotkey: '', look };
      p.avatars.push(a);
      return a;
    },
    async addBlank() { const a = this.add(null, blankLook()); await this.switchTo(a.id, { toast: false }); },
    async duplicate() {
      const cur = this.active();
      const a = this.add(`${cur ? cur.name : 'Random mix'} copy`, clone(takeLook(this.project)));
      await this.switchTo(a.id, { toast: false });
    },
    // the random mix on screen becomes a real avatar
    keepMix() {
      const p = this.project;
      if (p.activeAvatar !== RANDOM) return;
      const a = this.add(`Mix ${p.avatars.length + 1}`, null);
      p.activeAvatar = a.id;
      p.mix = null;
      this.app.changed({ settings: true });
      PT.Panels.renderAvatars();
      PT.toast(`Saved the mix as "${a.name}".`);
    },
    async remove(a) {
      const p = this.project;
      if (p.avatars.length < 2) return;
      // a switch in progress would leave the deleted avatar on screen
      if (this.busy) { PT.toast('Wait for the avatar switch to finish, then delete.', 'warn'); return; }
      if (a.id === p.activeAvatar) await this.switchTo(p.avatars.find((x) => x !== a).id, { animate: false, toast: false });
      p.avatars = p.avatars.filter((x) => x !== a);
      this.app.changed({ settings: true });
      await this.register();
    },
    rename(a, name) { a.name = (name || '').trim().slice(0, 60) || a.name; this.app.changed({ settings: true }); },
    async setHotkey(a, acc) {
      if (a === 'next' || a === 'random') this.project.hotkeys[a] = acc;
      else if (typeof a === 'string' && a.startsWith('action:')) {
        const id = a.slice(7), all = this.project.actions;
        all[id] = all[id] || { hotkey: '', settings: {} };
        all[id].hotkey = acc;
      } else if (typeof a === 'string' && a.startsWith('sequence:')) {
        const s = (this.project.sequences || []).find((x) => x.id === a.slice(9));
        if (s) s.hotkey = acc;
      } else a.hotkey = acc;
      this.app.changed({ settings: true });
      await this.register();
    },

    // avatars from a saved .easytuber.json file are added to this project
    async importFile(file) {
      const raw = JSON.parse(await file.text());
      const missing = await PT.Storage.missingPictures(raw);
      if (missing) throw new Error(`${missing} of its pictures are not in the file. Use "Save file" on the computer it came from and add that file instead.`);
      // the file's own parts join this project's, so its avatars keep their hats and tails
      const p = this.project, have = new Set(p.customParts.map((c) => c.id));
      const extra = PT.cleanCustomParts(raw && raw.customParts).filter((c) => !have.has(c.id));
      if (extra.length) { p.customParts = p.customParts.concat(extra); this.app.rigChanged(); }
      const data = PT.normalizeProject(raw, true);
      let n = 0;
      for (const a of data.avatars) {
        this.add(a.name, a.id === data.activeAvatar ? takeLook(data) : (a.look || blankLook()));
        n++;
      }
      if (data.activeAvatar === RANDOM) { this.add('Imported mix', takeLook(data)); n++; }
      this.app.changed({ settings: true });
      PT.Panels.renderAvatars();
      PT.toast(`Added ${n} avatar${n === 1 ? '' : 's'} from ${file.name}.`);
    },
  };

  PT.Avatars = Avatars;
})(window.PT);
