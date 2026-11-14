/* Rig definition: body parts, hierarchy, default layout, default settings, filename routing. */
(function (PT) {
  // Logical stage size (the picture OBS and the camera get), in stage units.
  PT.STAGE_W = 1920;
  PT.STAGE_H = 1080;
  // Character space: the frame avatars are laid out in. Its bottom center stands at the
  // bottom center of the stage, so avatars made for the old square stage still fit.
  PT.CHAR_W = 1920;
  PT.CHAR_H = 1080;

  /*
   * Parts in hierarchy order (parents always come before children).
   *  - parent: the part this one is attached to. Children follow the parent's
   *    motion (breathing, head bobs, arm swings) but are not stretched by it.
   *  - pivot: where the joint sits on the image by default (the rotation point).
   *  - states: image slots. Multi-state parts swap images (blinking, talking).
   */
  PT.PARTS = [
    { id: 'torso',     label: 'Torso',           group: 'Body',      parent: null,        pivot: 'bottom', states: ['main'],
      hint: 'Chest, shoulders and clothing. Breathes from the bottom up.' },
    { id: 'neck',      label: 'Neck',            group: 'Body',      parent: 'torso',     pivot: 'bottom', states: ['main'],
      hint: 'Sits behind the torso and face. Pivot = base of the neck.' },
    { id: 'face',      label: 'Face',            group: 'Head',      parent: 'neck',      pivot: 'bottom', states: ['main'],
      hint: 'Head / skin without eyes or mouth. Pivot = chin, where the head tilts from.' },
    { id: 'eyes',      label: 'Eyes',            group: 'Head',      parent: 'face',      pivot: 'center', states: ['open', 'half', 'closed'],
      stateLabels: { open: 'Open', half: 'Half', closed: 'Closed' },
      hint: 'Both eyes in one image. "Half" is optional and makes blinks smoother.' },
    { id: 'mouth',     label: 'Mouth',           group: 'Head',      parent: 'face',      pivot: 'center', states: ['closed', 'half', 'open'],
      stateLabels: { closed: 'Closed', half: 'Half', open: 'Open' },
      hint: 'Closed = quiet, Half = soft sounds, Open = talking loudly. Half is optional.' },
    { id: 'hairFront', label: 'Hair (front)',    group: 'Head',      parent: 'face',      pivot: 'top',    states: ['main'],
      hint: 'Bangs / fringe drawn over the face. Swings a little when the head moves.' },
    { id: 'hairBack',  label: 'Hair (back)',     group: 'Head',      parent: 'face',      pivot: 'top',    states: ['main'],
      hint: 'Hair behind the head and body. Optional.' },
    { id: 'armLUpper', label: 'Upper arm',       group: 'Left arm',  parent: 'torso',     pivot: 'shoulder', states: ['main'], side: 1,
      hint: 'Arm on the LEFT side of the screen. Pivot = shoulder.' },
    { id: 'armLLower', label: 'Forearm + hand',  group: 'Left arm',  parent: 'armLUpper', pivot: 'shoulder', states: ['main'], side: 1,
      hint: 'Pivot = elbow. Should overlap the bottom of the upper arm.' },
    { id: 'armRUpper', label: 'Upper arm',       group: 'Right arm', parent: 'torso',     pivot: 'shoulder', states: ['main'], side: -1,
      hint: 'Arm on the RIGHT side of the screen. Pivot = shoulder.' },
    { id: 'armRLower', label: 'Forearm + hand',  group: 'Right arm', parent: 'armRUpper', pivot: 'shoulder', states: ['main'], side: -1,
      hint: 'Pivot = elbow. Should overlap the bottom of the upper arm.' },
  ];
  PT.PART = Object.fromEntries(PT.PARTS.map((p) => [p.id, p]));
  PT.BASE_PARTS = PT.PARTS;   // the built-in skeleton; PT.PARTS also holds the user's own parts (see applyRig)
  PT.MIRROR = { armLUpper: 'armRUpper', armLLower: 'armRLower', armRUpper: 'armLUpper', armRLower: 'armLLower' };

  // Back-to-front draw order
  PT.DEFAULT_ORDER = ['hairBack', 'neck', 'torso', 'armLUpper', 'armLLower', 'armRUpper', 'armRLower', 'face', 'eyes', 'mouth', 'hairFront'];

  // Default placement, sized to fit the built-in placeholder art (w/h = placeholder image size).
  PT.LAYOUT = {
    torso:     { x: 500, y: 1000, rot: 0,  w: 400, h: 330, px: 200, py: 326 },
    neck:      { x: 500, y: 705,  rot: 0,  w: 76,  h: 100, px: 38,  py: 98 },
    face:      { x: 500, y: 650,  rot: 0,  w: 290, h: 330, px: 145, py: 318 },
    eyes:      { x: 500, y: 505,  rot: 0,  w: 210, h: 70,  px: 105, py: 35 },
    mouth:     { x: 500, y: 590,  rot: 0,  w: 90,  h: 56,  px: 45,  py: 28 },
    hairFront: { x: 500, y: 302,  rot: 0,  w: 330, h: 200, px: 165, py: 12 },
    hairBack:  { x: 500, y: 300,  rot: 0,  w: 360, h: 420, px: 180, py: 20 },
    armLUpper: { x: 340, y: 712,  rot: 7,  w: 78,  h: 175, px: 39,  py: 30 },
    armLLower: { x: 325, y: 831,  rot: 3,  w: 72,  h: 170, px: 36,  py: 26 },
    armRUpper: { x: 660, y: 712,  rot: -7, w: 78,  h: 175, px: 39,  py: 30 },
    armRLower: { x: 675, y: 831,  rot: -3, w: 72,  h: 170, px: 36,  py: 26 },
  };

  /* ---------- custom parts ----------
     Parts the user adds to the skeleton: a hat, a tail, a prop, a hand of its own. They are listed
     in project.customParts as { id: 'c_…', label, parent, sway } and are the same for every
     avatar; each avatar's look holds the art and placement, like any part. A custom part has one
     image, hangs from its parent, and swings behind it when the parent turns (sway 0 = stiff). */
  PT.MAX_CUSTOM_PARTS = 24;
  const BASE_ORDER = PT.DEFAULT_ORDER, BASE_LAYOUT = PT.LAYOUT;
  const CUSTOM_SIZE = 160;   // the slot a custom part's first image is fitted into

  // a part's name with its side, for lists where "Upper arm" alone says too little
  PT.partName = (def) => (def.group && /arm/i.test(def.group) ? def.group + ': ' : '') + def.label;

  // The valid custom parts in a list. A part may only hang from a built-in part or from a custom
  // part before it in the list, so parents always come first and there are no loops.
  PT.cleanCustomParts = (list) => {
    const out = [], ids = new Set(PT.BASE_PARTS.map((p) => p.id));
    for (const c of Array.isArray(list) ? list : []) {
      if (out.length >= PT.MAX_CUSTOM_PARTS) break;
      if (!c || typeof c.id !== 'string' || !/^c_[a-z0-9]{1,16}$/.test(c.id) || ids.has(c.id)) continue;
      out.push({
        id: c.id,
        label: (typeof c.label === 'string' ? c.label.trim().slice(0, 40) : '') || 'Part',
        parent: ids.has(c.parent) ? c.parent : 'torso',
        sway: Number.isFinite(c.sway) ? Math.max(0, Math.min(2, c.sway)) : 1,
      });
      ids.add(c.id);
    }
    return out;
  };

  /* Rebuild the skeleton (PT.PARTS, PT.PART, PT.DEFAULT_ORDER, PT.LAYOUT) for a project's custom
     parts. Everything that walks the skeleton reads these, so nothing else needs to know custom
     parts exist. Returns the cleaned list. */
  PT.applyRig = (project) => {
    const custom = PT.cleanCustomParts(project && project.customParts);
    const parts = PT.BASE_PARTS.slice(), byId = Object.fromEntries(parts.map((p) => [p.id, p]));
    const layout = { ...BASE_LAYOUT };
    for (const c of custom) {
      const parent = byId[c.parent];
      const def = {
        id: c.id, label: c.label, group: 'Your parts', parent: c.parent, pivot: 'center', states: ['main'], custom: true, sway: c.sway,
        hint: `Your own part. It moves with "${PT.partName(parent)}" and swings a little behind it.`,
      };
      parts.push(def); byId[c.id] = def;
      // starts at the joint of what it hangs from
      layout[c.id] = { x: layout[c.parent].x, y: layout[c.parent].y, rot: 0, w: CUSTOM_SIZE, h: CUSTOM_SIZE, px: CUSTOM_SIZE / 2, py: CUSTOM_SIZE / 2 };
    }
    PT.PARTS = parts; PT.PART = byId; PT.LAYOUT = layout;
    PT.DEFAULT_ORDER = [...BASE_ORDER, ...custom.map((c) => c.id)];   // new parts are drawn in front
    return custom;
  };
  // the custom parts of the skeleton as it is now
  PT.customParts = () => PT.PARTS.filter((d) => d.custom).map((d) => ({ id: d.id, label: d.label, parent: d.parent, sway: d.sway }));

  /* Make a look fit the skeleton as it is now: a part it has no entry for gets a default one
     (a custom part at the joint of its parent), and parts that no longer exist are dropped. */
  PT.syncLook = (look) => {
    if (!look || typeof look !== 'object' || !look.parts || typeof look.parts !== 'object') return look;
    for (const def of PT.PARTS) {
      if (look.parts[def.id]) continue;
      const d = PT.defaultPart(def.id), par = def.custom && look.parts[def.parent];
      if (par && Number.isFinite(par.x) && Number.isFinite(par.y)) { d.x = par.x; d.y = par.y; }
      look.parts[def.id] = d;
    }
    for (const id of Object.keys(look.parts)) if (!PT.PART[id]) delete look.parts[id];
    const order = (Array.isArray(look.order) ? look.order : []).filter((id, i, a) => PT.PART[id] && a.indexOf(id) === i);
    for (const id of PT.DEFAULT_ORDER) if (!order.includes(id)) order.push(id);
    look.order = order;
    return look;
  };

  PT.DEFAULT_MOTION = {
    breathSpeed: 4.2,   // seconds per breath
    breathAmount: 1,
    idleSway: 1,
    blinkInterval: 4,   // average seconds between blinks
    doubleBlink: 0.15,  // chance of a double blink
    headBob: 1,
    headTilt: 1,
    bodyBounce: 1,
    armSway: 1,
    gesture: 1,
    hairPhysics: 1,
  };

  PT.DEFAULT_MIC = {
    deviceId: '',
    sensitivity: 50,    // 0..100
    talk: 0.32,         // level where the mouth starts opening
    open: 0.58,         // level where the mouth is fully open
    hold: 140,          // ms the mouth stays open after sound stops
  };

  PT.DEFAULT_STAGE = {
    bg: 'transparent',  // transparent | green | blue | magenta | custom
    color: '#20202a',
    placeholders: true,
    skeleton: true,
    moveChildren: true,
    onion: true,        // show the first frame faintly while lining up another
    actionSound: 'editor',  // where action sounds play: editor | obs (the stage pages) | off
    actionVolume: 100,      // 0..100, for every action sound
    updateNotice: true,     // ask GitHub at start-up whether a newer version is out
  };

  PT.BG_COLORS = { green: '#00ff00', blue: '#0000ff', magenta: '#ff00ff' };

  PT.defaultPart = (id) => {
    const L = PT.LAYOUT[id];
    // adj: per-frame fine-tune { state: { dx, dy, s } } for frames that don't line up exactly
    return { images: {}, adj: {}, x: L.x, y: L.y, rot: L.rot, scale: 1, px: L.px, py: L.py, flip: false, visible: true };
  };

  PT.defaultProject = () => ({
    version: 1,
    name: 'My avatar',
    parts: Object.fromEntries(PT.PARTS.map((p) => [p.id, PT.defaultPart(p.id)])),
    order: PT.DEFAULT_ORDER.slice(),
    root: { x: 0, y: 0, scale: 1 },
    // sprite sheets kept so crops can be re-edited: { id, name, url, w, h, boxes: [{ id, part, state, x, y, w, h }] }
    sheets: [],
    customParts: PT.customParts(),   // the user's own parts (see applyRig); the same for every avatar
    motion: { ...PT.DEFAULT_MOTION },
    mic: { ...PT.DEFAULT_MIC },
    stage: { ...PT.DEFAULT_STAGE },
    /* Avatar layouts. The active one's look lives in parts/order/root/sheets above (look: null);
       every other avatar keeps its own look here. activeAvatar can also be 'random' (a random mix). */
    avatars: [{ id: 'a1', name: 'Avatar 1', hotkey: '', look: null }],
    activeAvatar: 'a1',
    hotkeys: { next: '', random: '' },   // Electron accelerators, e.g. "Ctrl+Alt+1"
    switchFx: true,                      // drop out / climb back in when switching
    actions: {},                         // { [actionId]: { hotkey, settings: { key: value }, cooldown } }
    // sequences saved in the Actions tab: [{ id, name, steps, startDelay, delay, values, hotkey }]
    // steps: action ids, 'next', 'random' or 'avatar:<id>'. Times in seconds, null = none / automatic.
    sequences: [],
  });

  // the fields that make up one avatar's look
  PT.LOOK_KEYS = ['parts', 'order', 'root', 'sheets'];

  /* Fill in anything missing (older files / partial imports).
     A project brings its own custom parts, so the skeleton is rebuilt for it first. keepRig is for
     normalising one avatar's look, which has no list of its own: the skeleton stays as it is. */
  PT.normalizeProject = (p, keepRig = false) => {
    if (!keepRig) PT.applyRig(p);
    const d = PT.defaultProject();
    if (!p || typeof p !== 'object') return d;
    const out = { ...d, ...p };
    out.customParts = PT.customParts();
    out.parts = {};
    for (const def of PT.PARTS) {
      out.parts[def.id] = { ...PT.defaultPart(def.id), ...((p.parts || {})[def.id] || {}) };
      out.parts[def.id].images = { ...((p.parts || {})[def.id] || {}).images };
      out.parts[def.id].adj = { ...((p.parts || {})[def.id] || {}).adj };
    }
    out.sheets = Array.isArray(p.sheets) ? p.sheets.filter((s) => s && s.url && Array.isArray(s.boxes)) : [];
    const order = Array.isArray(p.order) ? p.order.filter((id, i, a) => PT.PART[id] && a.indexOf(id) === i) : [];
    for (const id of PT.DEFAULT_ORDER) if (!order.includes(id)) order.push(id);
    out.order = order;
    out.root = { ...d.root, ...(p.root || {}) };
    out.motion = { ...d.motion, ...(p.motion || {}) };
    out.mic = { ...d.mic, ...(p.mic || {}) };
    out.stage = { ...d.stage, ...(p.stage || {}) };

    // avatars: files from before avatars existed get one avatar holding the current look
    const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');
    const seen = new Set();
    out.avatars = (Array.isArray(p.avatars) ? p.avatars : [])
      .filter((a) => a && typeof a.id === 'string' && a.id && !seen.has(a.id) && seen.add(a.id))
      .map((a) => ({ id: a.id, name: str(a.name, 60) || 'Avatar', hotkey: str(a.hotkey, 64), look: a.look && typeof a.look === 'object' ? a.look : null }));
    if (!out.avatars.length) out.avatars = [{ id: 'a1', name: str(p.name, 60) || 'Avatar 1', hotkey: '', look: null }];
    // 'random' only when every avatar has its own look stored (else one avatar's look is the one above)
    const known = out.avatars.some((a) => a.id === p.activeAvatar);
    const randomOk = p.activeAvatar === 'random' && out.avatars.every((a) => a.look);
    out.activeAvatar = known || randomOk ? p.activeAvatar : (out.avatars.find((a) => !a.look) || out.avatars[0]).id;
    for (const a of out.avatars) if (a.id === out.activeAvatar) a.look = null;   // its look is the one above
    out.hotkeys = { next: str((p.hotkeys || {}).next, 64), random: str((p.hotkeys || {}).random, 64) };
    out.switchFx = p.switchFx !== false;
    // per action (js/actions/*.js): its global hotkey and its settings. Shared by every avatar.
    // Entries for actions whose file is gone are kept, in case the file comes back.
    const seqIds = new Set();
    out.sequences = (Array.isArray(p.sequences) ? p.sequences : [])
      .filter((s) => s && typeof s.id === 'string' && /^[\w-]{1,40}$/.test(s.id) && !seqIds.has(s.id) && seqIds.add(s.id))
      .map((s) => ({
        id: s.id,
        name: str(s.name, 60) || 'Sequence',
        steps: (Array.isArray(s.steps) ? s.steps : []).filter((n) => typeof n === 'string' && /^([\w-]{1,40}|avatar:[\w-]{1,40})$/.test(n)).slice(0, 8),
        startDelay: Number.isFinite(s.startDelay) && s.startDelay > 0 && s.startDelay <= 60 ? Math.round(s.startDelay * 10) / 10 : null,
        delay: Number.isFinite(s.delay) && s.delay >= 0.1 && s.delay <= 60 ? Math.round(s.delay * 10) / 10 : null,
        values: str(s.values, 400),
        hotkey: str(s.hotkey, 64),
      }))
      .filter((s) => s.steps.length)
      .slice(0, 50);
    out.actions = {};
    for (const [id, a] of Object.entries(p.actions && typeof p.actions === 'object' ? p.actions : {})) {
      if (!/^[\w-]{1,40}$/.test(id) || !a || typeof a !== 'object') continue;
      const settings = {};
      for (const [k, v] of Object.entries(a.settings && typeof a.settings === 'object' ? a.settings : {})) {
        if (/^[\w-]{1,40}$/.test(k) && (typeof v === 'boolean' || Number.isFinite(v))) settings[k] = v;
      }
      // cooldown: seconds before Streamer.bot may play it again (0 = none)
      const cooldown = Number.isFinite(a.cooldown) ? Math.max(0, Math.min(3600, a.cooldown)) : 0;
      out.actions[id] = { hotkey: str(a.hotkey, 64), settings, cooldown };
    }
    return out;
  };

  /* ---------- filename -> part/state routing for bulk drops ---------- */
  PT.routeFilename = (name) => {
    const base = name.toLowerCase().replace(/\.[a-z0-9]+$/, '');
    const tokens = base.split(/[^a-z0-9]+/).filter(Boolean);
    const has = (...w) => w.some((x) => tokens.includes(x));
    const re = (r) => r.test(base);

    // your own parts first, by name: "Party hat" takes party-hat.png and my_party_hat_v2.png (every
    // word of the name is a word of the file name) and partyhat.png. The longest name wins.
    const words = (s) => s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
    const mine = PT.PARTS.filter((d) => d.custom && words(d.label).length)
      .sort((a, b) => words(b.label).length - words(a.label).length || b.label.length - a.label.length);
    for (const d of mine) {
      const w = words(d.label);
      if (w.every((x) => tokens.includes(x)) || tokens.join('') === w.join('')) return { part: d.id, state: 'main' };
    }

    if (re(/eye|blink/)) {
      if (re(/half|mid|squint/)) return { part: 'eyes', state: 'half' };
      if (re(/clos|blink|shut/)) return { part: 'eyes', state: 'closed' };
      return { part: 'eyes', state: 'open' };
    }
    if (re(/mouth|lip|talk/)) {
      if (re(/half|mid|small/)) return { part: 'mouth', state: 'half' };
      if (re(/clos|shut|idle|quiet/)) return { part: 'mouth', state: 'closed' };
      if (re(/open|talk|wide|big/)) return { part: 'mouth', state: 'open' };
      return { part: 'mouth', state: 'closed' };
    }
    if (re(/hair|bang|fringe/)) {
      if (re(/back|behind|rear/)) return { part: 'hairBack', state: 'main' };
      return { part: 'hairFront', state: 'main' };
    }
    if (re(/arm|hand|elbow|shoulder|bicep/)) {
      let side = null;
      if (has('l', 'left', 'lft') || re(/left|(^|[^a-z])l(upper|lower|top|bottom)/)) side = 'L';
      else if (has('r', 'right', 'rgt') || re(/right|(^|[^a-z])r(upper|lower|top|bottom)/)) side = 'R';
      const lower = re(/lower|fore|bottom|low|hand|bot/);
      const seg = lower ? 'Lower' : 'Upper';
      if (!side) return { part: null, reason: 'arm side (left/right) not found in name' };
      return { part: 'arm' + side + seg, state: 'main' };
    }
    if (re(/neck/)) return { part: 'neck', state: 'main' };
    if (re(/torso|body|chest|shirt|bust|outfit|cloth/)) return { part: 'torso', state: 'main' };
    if (re(/face|head|skin/)) return { part: 'face', state: 'main' };
    return { part: null };
  };
})(window.PT);
