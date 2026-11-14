/* Accessories: pictures you upload once (a hat, glasses, a bow, a collar) and put on a part of
   your own on any skin or avatar.

   They are kept in the parts library with kind 'accessory' (see library.js), so their pictures are
   files like any other and they travel with Save file. Putting one on sets that part's picture in
   that avatar's look; a part is a custom part (see defs.js applyRig) and every avatar has it. */
(function (PT) {
  const { M } = PT;
  const uid = () => 'l' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const SLOT = 160;   // a picture with nothing to line up with is fitted into this, at the part's joint

  const Accessories = {
    get project() { return PT.App.project; },
    list() { return (this.project.library || []).filter((x) => x.kind === 'accessory'); },
    picture(item) { return item.images.main || Object.values(item.images)[0] || null; },
    customParts() { return PT.PARTS.filter((d) => d.custom); },

    // one accessory per picture; the name comes from the file
    async upload(files) {
      const L = PT.Library, added = [];
      for (const f of Array.from(files).filter((x) => /^image\//.test(x.type) || /\.(png|webp|gif|jpe?g)$/i.test(x.name))) {
        if (L.list().length >= L.MAX) { PT.toast(`The library is full (${L.MAX}).`, 'warn'); break; }
        let url;
        try { url = await PT.Assets.fileToDataURL(f); } catch (e) { PT.toast(`Could not read ${f.name}: ${e.message}`, 'error'); continue; }
        const item = { id: uid(), kind: 'accessory', name: f.name.replace(/\.[a-z0-9]+$/i, '').slice(0, 60) || 'Accessory', part: '', images: { main: url }, adj: {}, place: null, at: Date.now() };
        L.list().push(item);
        added.push(item);
      }
      if (added.length) PT.App.changed({ settings: true });   // saving moves the pictures out to files
      return added;
    },

    // where it is worn: [{ avatar, part }]
    wearers(item) {
      const pic = this.picture(item), A = PT.Avatars, out = [];
      if (!pic) return out;
      for (const a of this.project.avatars) {
        const look = A.lookOf(a);
        for (const d of PT.PARTS) {
          const part = look.parts && look.parts[d.id];
          if (part && part.images && Object.values(part.images).includes(pic)) out.push({ avatar: a, part: d.id });
        }
      }
      return out;
    },

    /* Where a new picture goes on a look: lined up with a part of that look drawn on a canvas of
       the same size (layers exported together line up exactly), else fitted at the part's joint. */
    async place(look, partId, url) {
      const img = await PT.loadImage(url);
      const w = img.naturalWidth, h = img.naturalHeight, part = look.parts[partId];
      Object.assign(part, { px: w / 2, py: h / 2, rot: 0, flip: false });
      for (const d of PT.PARTS) {
        const other = look.parts[d.id];
        if (d.id === partId || !other || !other.visible) continue;
        const src = Object.values(other.images || {})[0];
        if (!src) continue;
        let o;
        try { o = await PT.loadImage(src); } catch (e) { continue; }
        if (o.naturalWidth === w && o.naturalHeight === h) {
          Object.assign(part, { rot: other.rot, scale: other.scale, flip: other.flip });
          [part.x, part.y] = M.apply(PT.Renderer.restMatrix(other), part.px, part.py);
          return 'aligned';
        }
      }
      part.scale = Math.min(SLOT / w, SLOT / h);
      return 'fitted';
    },

    /* Put an accessory on a part of an avatar. partId 'new': a part of its own is made for it
       (named after it, attached to the face), which every avatar then has. Returns the part id. */
    async wear(item, avatarId, partId) {
      const app = PT.App, p = this.project, url = this.picture(item);
      const avatar = p.avatars.find((a) => a.id === avatarId) || (avatarId === PT.Avatars.RANDOM ? null : undefined);
      if (!url || avatar === undefined) return null;
      if (partId === 'new') {
        if (p.customParts.length >= PT.MAX_CUSTOM_PARTS) { PT.toast(`That is the most parts you can add (${PT.MAX_CUSTOM_PARTS}).`, 'warn'); return null; }
        partId = 'c_' + Math.random().toString(36).slice(2, 10).padEnd(4, '0');
        p.customParts.push({ id: partId, label: item.name.slice(0, 40), parent: 'face', sway: 0.5 });
        app.rigChanged();                                  // every look now has the part
      }
      if (!PT.PART[partId]) return null;
      const onScreen = !avatar || avatar.id === p.activeAvatar;
      const look = onScreen ? p : avatar.look;
      if (!look || !look.parts || !look.parts[partId]) return null;
      look.parts[partId].images = { main: url };
      look.parts[partId].adj = {};
      look.parts[partId].visible = true;
      await this.place(look, partId, url);
      if (onScreen) { await PT.Assets.loadProject(p); PT.Editor.resetHistory(); }
      app.changed({ structure: true });
      return partId;
    },

    // take whatever picture a part of an avatar has off it
    async takeOff(avatarId, partId) {
      const p = this.project, a = p.avatars.find((x) => x.id === avatarId);
      const onScreen = avatarId === p.activeAvatar;
      const look = onScreen ? p : a && a.look;
      if (!look || !look.parts[partId]) return;
      look.parts[partId].images = {};
      look.parts[partId].adj = {};
      if (onScreen) { await PT.Assets.loadProject(p); PT.Editor.resetHistory(); }
      PT.App.changed({ structure: true });
    },
  };

  PT.Accessories = Accessories;
})(window.PT);
