/* The avatar-switch animation: every part hops, spins and drops off the bottom of the screen,
   then the new avatar's parts climb back up from below, base first, with a little overshoot.
   Offsets are in stage units (the 1920 x 1080 stage); the renderer applies them. */
(function (PT) {
  const OUT_MS = 650;       // until the last part has left the screen
  const IN_MS = 950;        // until the last part has landed
  const HIDDEN_MAX_MS = 6000; // never leave the stage empty if the new avatar doesn't arrive
  const G = 5200;           // gravity, stage units / s²

  // climb-in order: what the rest of the body stands on comes first
  const IN_DELAY = {
    torso: 0, neck: 0.05, armLUpper: 0.08, armRUpper: 0.08, armLLower: 0.13, armRLower: 0.13,
    hairBack: 0.12, face: 0.14, eyes: 0.24, mouth: 0.26, hairFront: 0.3,
  };

  const easeOutBack = (u) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(u - 1, 3) + c1 * Math.pow(u - 1, 2); };
  const rand = (a, b) => a + Math.random() * (b - a);

  PT.Transition = {
    OUT_MS, IN_MS,
    phase: 'idle',   // idle | out | hidden | in
    t0: 0,
    parts: {},

    get active() { return this.phase !== 'idle'; },
    // true while the old avatar is still falling (the new one must not be swapped in yet)
    get falling() { return this.phase === 'out' && performance.now() - this.t0 < OUT_MS; },

    out() {
      if (this.phase === 'out' || this.phase === 'hidden') return;
      this.phase = 'out';
      this.t0 = performance.now();
      this.parts = {};
      for (const def of PT.PARTS) {
        this.parts[def.id] = {
          delay: rand(0, 0.12),
          vy: rand(-650, -250),            // a little hop before the fall
          vx: rand(-180, 180),
          spin: rand(-260, 260),           // degrees per second
        };
      }
    },

    in() {
      this.phase = 'in';
      this.t0 = performance.now();
      this.parts = {};
      for (const def of PT.PARTS) this.parts[def.id] = { delay: (IN_DELAY[def.id] || 0) + rand(0, 0.05), rot: rand(-14, 14) };
    },

    // for "Test the animation": out, then straight back in
    play() { if (this.active) return; this.out(); setTimeout(() => this.in(), OUT_MS + 120); },

    /* Per-part offset for this frame: { dx, dy, rot } or { hide: true }, or null when idle. */
    fx(id, now = performance.now()) {
      if (this.phase === 'idle') return null;
      const el = now - this.t0, p = this.parts[id];
      if (this.phase === 'out' && el > OUT_MS) this.phase = 'hidden';
      if (this.phase === 'hidden') {
        if (el > HIDDEN_MAX_MS) this.in();
        return { hide: true };
      }
      if (this.phase === 'in' && el > IN_MS) { this.phase = 'idle'; return null; }
      if (!p) return null;
      const t = el / 1000 - p.delay;
      if (this.phase === 'out') {
        if (t <= 0) return null;
        return { dx: p.vx * t, dy: p.vy * t + 0.5 * G * t * t, rot: p.spin * t };
      }
      // in: rise from below the stage
      if (t <= 0) return { hide: true };
      const u = Math.min(1, t / 0.55), e = easeOutBack(u);
      return { dx: 0, dy: (1 - e) * 1100, rot: (1 - Math.min(1, u * 1.4)) * p.rot };
    },
  };
})(window.PT);
