/* The parts library, and swapping a part for another one.

   The library is a set of parts kept apart from any avatar: a hat, a pair of eyes, a whole arm.
   It is saved in the avatar file as project.library and shared by every avatar:
     { id, name, part, images: { state: picture }, adj, place, at }
   part   = the part it was made for ('' = any part)
   place  = where it sat when it was saved ({ x, y, rot, scale, px, py, flip }), or null for an
            uploaded picture, which is fitted into place like any new upload.
   The pictures are files in the images folder, like every picture of an avatar (see storage.js).

   A part on screen can be swapped for the same part of another avatar, or for a library part. */
(function (PT) {
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const PLACE = ['x', 'y', 'rot', 'scale', 'px', 'py', 'flip'];
  const uid = () => 'l' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const isPicture = (v) => typeof v === 'string' && (PT.isImageRef(v) || /^data:image\//.test(v));
  const MAX = 500;

  // the picture that stands for a set of images: the first of the part's states, else any
  function cover(images, partId) {
    const def = PT.PART[partId];
    for (const st of def ? def.states : []) if (isPicture(images[st])) return images[st];
    for (const st of ['main', 'open', 'closed', 'half']) if (isPicture((images || {})[st])) return images[st];
    const k = Object.keys(images || {}).filter((x) => isPicture(images[x]) && !x.includes('@')).sort()[0];
    return k ? images[k] : null;
  }

  /* A part's images, made to fit another part: the same states where both have them; a single
     picture becomes the first state. Images for expressions ('open@happy') come along when the
     state exists. */
  function fitImages(images, toId) {
    const def = PT.PART[toId], out = {};
    if (!def) return out;
    const states = def.states.concat(def.extra || []);
    for (const [k, v] of Object.entries(images || {})) {
      if (!isPicture(v)) continue;
      const [st, expr] = k.split('@');
      if (states.includes(st)) out[expr ? st + '@' + expr : st] = v;
    }
    if (!Object.keys(out).some((k) => !k.includes('@'))) {
      const one = cover(images, toId) || Object.values(images || {}).find(isPicture);
      if (one) out[def.states[0]] = one;
    }
    return out;
  }

  // words in a file name that say which frame it is, not which item: eyes_closed and eyes_open are one pair
  const FRAME_WORD = /^(open|opened|closed|close|shut|half|mid|blink|blinking|talk|talking|idle|quiet|small|wide|big|a|ah|aa|o|oh|oo|u|e|ee|eh|i)$/;

  /* How uploaded pictures become library entries: [{ part, name, files: [{ index, state }] }].
     names = the file names; partId = the part they were uploaded for, or null to tell from the names.
     Every picture is an entry of its own, except frames of one item: pictures for a part with
     several frames (eyes, mouth) whose names differ only by the frame word go together. */
  function groupUploads(names, partId = null) {
    const groups = new Map();
    names.forEach((fileName, index) => {
      const r = partId ? { part: partId } : PT.routeFilename(fileName);
      const part = r.part || '', def = PT.PART[part];
      const frames = def ? def.states.concat(def.extra || []) : [];
      let state = null, key = 'file:' + index;
      if (def && frames.length > 1) {
        const n = PT.routeFilename(fileName);
        state = n.part === part ? n.state : null;
        const words = fileName.toLowerCase().replace(/\.[a-z0-9]+$/, '').split(/[^a-z0-9]+/).filter(Boolean);
        const item = words.filter((w) => !FRAME_WORD.test(w)).join('-');
        if (state && item) key = part + ':' + item;          // a frame of an item: grouped with its other frames
      } else if (def) state = 'main';
      const g = groups.get(key) || { part, name: '', files: [], base: fileName.replace(/\.[a-z0-9]+$/i, '') };
      if (def && (!state || g.files.some((x) => x.state === state))) state = frames.find((s) => !g.files.some((x) => x.state === s)) || frames[0];
      g.files.push({ index, state: state || 'main' });
      groups.set(key, g);
    });
    return [...groups.values()].map((g) => {
      const def = PT.PART[g.part];
      // one picture: its file name; frames of one item: the name without the frame word
      const name = g.files.length === 1 ? g.base
        : g.base.split(/[^A-Za-z0-9]+/).filter((w) => w && !FRAME_WORD.test(w.toLowerCase())).join(' ') || (def ? PT.partName(def) : g.base);
      return { part: g.part, name: name.slice(0, 60), files: g.files };
    });
  }

  const Library = {
    MAX, cover, fitImages, groupUploads,
    undo: null,          // { id, part, avatar } : what the last swap replaced, so it can be put back

    get project() { return PT.App.project; },
    list() { return this.project.library || (this.project.library = []); },
    // library parts (not accessories) for a part: the ones made for it, then (all) the rest
    parts() { return this.list().filter((x) => x.kind !== 'accessory'); },
    for(partId, all = false) { return this.parts().filter((x) => x.part === partId || (all && x.part !== partId)); },

    // every other avatar's version of a part, when it has a picture: [{ avatar, part }]
    fromAvatars(partId) {
      const p = this.project, out = [];
      for (const a of p.avatars) {
        if (a.id === p.activeAvatar || !a.look || !a.look.parts) continue;
        const part = a.look.parts[partId];
        if (part && cover(part.images || {}, partId)) out.push({ avatar: a, part });
      }
      return out;
    },

    /* Put a part from somewhere else in place of part `id` of the avatar on screen.
       src = { images, adj, place, part }. The placement comes along when it was the same part;
       otherwise the picture is fitted into place. */
    async apply(id, src) {
      const app = PT.App, p = this.project, part = p.parts[id];
      if (!part || !src) return false;
      this.undo = { id, part: clone(part), avatar: p.activeAvatar };
      const same = src.part === id;
      part.images = fitImages(src.images, id);
      part.adj = same ? clone(src.adj || {}) : {};
      const place = same && src.place ? src.place : null;
      if (place) for (const k of PLACE) if (k in place) part[k] = place[k];
      part.visible = true;
      await PT.Assets.loadProject(p);
      if (!place) {
        const e = PT.Assets.primary(id, false);
        if (e) PT.Editor.autoPlace(id, e);   // lines up with parts drawn on the same canvas, else fits the slot
      }
      PT.Editor.resetHistory();
      app.changed({ structure: true });
      return true;
    },
    // the part as it was before the last swap
    async undoSwap() {
      const u = this.undo, p = this.project;
      if (!u || u.avatar !== p.activeAvatar || !p.parts[u.id]) return false;
      p.parts[u.id] = u.part;
      this.undo = null;
      await PT.Assets.loadProject(p);
      PT.Editor.resetHistory();
      PT.App.changed({ structure: true });
      return true;
    },

    // keep the part on screen in the library, with its placement
    save(id, name) {
      const p = this.project, part = p.parts[id];
      if (!part || !cover(part.images || {}, id)) return null;
      if (this.list().length >= MAX) { PT.toast(`The library is full (${MAX} parts).`, 'warn'); return null; }
      const place = {};
      for (const k of PLACE) place[k] = part[k];
      const item = { id: uid(), kind: 'part', name: (name || `${PT.Avatars.activeName()}: ${PT.partName(PT.PART[id])}`).slice(0, 60), part: id, images: clone(part.images), adj: clone(part.adj || {}), place, at: Date.now() };
      this.list().push(item);
      PT.App.changed({ settings: true });
      return item;
    },

    /* Add pictures to the library. partId: the part they are for, or null to tell from the file
       names (eyes_closed.png is the closed eyes). Pictures for the same part from one upload make
       one library part (open, half and closed eyes together). Returns the parts added. */
    async upload(files, partId = null) {
      files = Array.from(files).filter((f) => /^image\//.test(f.type) || /\.(png|webp|gif|jpe?g)$/i.test(f.name));
      const added = [];
      for (const g of groupUploads(files.map((f) => f.name), partId)) {
        const images = {};
        for (const { index, state } of g.files) {
          try { images[state] = await PT.Assets.fileToDataURL(files[index]); } catch (e) { PT.toast(`Could not read ${files[index].name}: ${e.message}`, 'error'); }
        }
        if (!Object.keys(images).length) continue;
        if (this.list().length >= MAX) { PT.toast(`The library is full (${MAX} parts).`, 'warn'); break; }
        const item = { id: uid(), kind: 'part', name: g.name, part: g.part, images, adj: {}, place: null, at: Date.now() };
        this.list().push(item);
        added.push(item);
      }
      if (added.length) PT.App.changed({ settings: true });   // saving moves the pictures out to files
      return added;
    },

    rename(item, name) { item.name = (name || '').trim().slice(0, 60) || item.name; PT.App.changed({ settings: true }); },
    setPart(item, partId) { item.part = PT.PART[partId] ? partId : ''; item.place = null; PT.App.changed({ settings: true }); },
    remove(item) { this.project.library = this.list().filter((x) => x !== item); PT.App.changed({ settings: true }); },
  };

  PT.Library = Library;
})(window.PT);
