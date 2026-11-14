/* The editor's side panels: they float over the stage, slide away and back, and the right one can
   be made wider or narrower by dragging its inner edge. The stage frames the avatar in the space
   the panels leave free (insets), so nothing hides behind a panel.

   How the panels are left is remembered in this browser (localStorage): it is a matter of taste
   for this computer, not part of the avatar. */
(function (PT) {
  const KEY = 'easytuber.panels';
  const RIGHT_MIN = 300, RIGHT_DEFAULT = 340;
  const $ = (id) => document.getElementById(id);

  const Layout = {
    left: true, right: true, rightW: RIGHT_DEFAULT,
    l: 0, r: 0,              // how much of the stage each panel covers right now, CSS px (measured each frame)

    load() {
      try {
        const s = JSON.parse(localStorage.getItem(KEY) || '{}');
        if (typeof s.left === 'boolean') this.left = s.left;
        if (typeof s.right === 'boolean') this.right = s.right;
        if (Number.isFinite(s.rightW)) this.rightW = s.rightW;
      } catch (e) { /* no storage: the defaults */ }
    },
    keep() {
      try { localStorage.setItem(KEY, JSON.stringify({ left: this.left, right: this.right, rightW: Math.round(this.rightW) })); } catch (e) { /* no storage */ }
    },
    maxRight() { return Math.max(RIGHT_MIN, Math.round(window.innerWidth * 0.7)); },

    init() {
      this.load();
      this.area = document.querySelector('.stage-area');
      this.leftEl = document.querySelector('.panel.left');
      this.rightEl = document.querySelector('.panel.right');
      if (!this.area || !this.leftEl || !this.rightEl) return;
      $('toggleLeft').onclick = () => this.set('left', !this.left);
      $('toggleRight').onclick = () => this.set('right', !this.right);
      this.grip($('gripRight'));
      window.addEventListener('resize', () => this.apply());
      this.apply();
      document.body.classList.add('panels-ready');   // from now on, changes slide instead of jumping
    },

    set(side, open) {
      this[side] = !!open;
      this.apply();
      this.keep();
    },

    apply() {
      this.rightW = PT.clamp(this.rightW, RIGHT_MIN, this.maxRight());
      this.rightEl.style.width = this.rightW + 'px';
      this.leftEl.classList.toggle('collapsed', !this.left);
      this.rightEl.classList.toggle('collapsed', !this.right);
      const tl = $('toggleLeft'), tr = $('toggleRight');
      tl.textContent = this.left ? '‹' : '›';
      tl.title = this.left ? 'Hide the parts panel' : 'Show the parts panel';
      tr.textContent = this.right ? '›' : '‹';
      tr.title = this.right ? 'Hide the settings panel' : 'Show the settings panel';
      tl.setAttribute('aria-expanded', String(this.left));
      tr.setAttribute('aria-expanded', String(this.right));
    },

    // drag the right panel's inner edge to resize it; a double-click puts it back to its usual width
    grip(el) {
      el.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        el.setPointerCapture(e.pointerId);
        document.body.classList.add('resizing');
        if (!this.right) this.set('right', true);
        const startX = e.clientX, startW = this.rightW;
        const move = (ev) => { this.rightW = PT.clamp(startW + (startX - ev.clientX), RIGHT_MIN, this.maxRight()); this.apply(); };
        const up = () => {
          el.removeEventListener('pointermove', move);
          el.removeEventListener('pointerup', up);
          el.removeEventListener('pointercancel', up);
          document.body.classList.remove('resizing');
          this.keep();
        };
        el.addEventListener('pointermove', move);
        el.addEventListener('pointerup', up);
        el.addEventListener('pointercancel', up);
      });
      el.addEventListener('dblclick', () => { this.rightW = RIGHT_DEFAULT; this.apply(); this.keep(); });
    },

    /* Once a frame: how far each panel reaches into the stage right now (it changes while one
       slides). The renderer frames the avatar between them, and the hint follows. */
    measure() {
      if (!this.area) return;
      const a = this.area.getBoundingClientRect();
      const lr = this.leftEl.getBoundingClientRect(), rr = this.rightEl.getBoundingClientRect();
      const l = Math.max(0, Math.min(a.width, lr.right - a.left)), r = Math.max(0, Math.min(a.width, a.right - rr.left));
      if (l !== this.l || r !== this.r) {
        this.l = l; this.r = r;
        const hint = $('stageHint');
        if (hint) hint.style.left = Math.round(l + 12) + 'px';
      }
    },
  };

  PT.Layout = Layout;
})(window.PT);
