/* Victory pose (held): both arms up, chest out, a happy bounce while it is on, sparkles twinkling by the hands. */
(function () {
  function chain(roots) {
    const ids = new Set(roots);
    for (const d of PT.PARTS) if (d.parent && ids.has(d.parent)) ids.add(d.id);
    return [...ids];
  }

  function sparkle(g, x, y, r) {
    g.beginPath();
    for (let i = 0; i < 8; i++) {
      const ang = (i * Math.PI) / 4 - Math.PI / 2, rr = i % 2 ? r * 0.35 : r;
      g.lineTo(x + Math.cos(ang) * rr, y + Math.sin(ang) * rr);
    }
    g.closePath();
    g.fill();
  }

  // a fixed number 0..1 for (seed, n): the same on every page, so every page twinkles in the same spot
  function hash(seed, n) { const v = Math.sin(n * 12.9898 + (seed % 1000) * 78.233) * 43758.5453; return v - Math.floor(v); }

  const TWINKLE_MS = 1200;

  PT.Actions.define({
    id: 'victory',
    label: 'Victory pose',
    hold: true,
    release: 400,
    settings: [
      { key: 'strength', label: 'Strength', type: 'range', min: 0, max: 150, step: 5, default: 100, suffix: '%' },
      { key: 'effects', label: 'Sparkles', type: 'check', default: true },
    ],

    pose(a) {
      const e = a.envelope(300) * a.settings.strength / 100;
      const b = 0.5 + 0.5 * Math.sin(a.ms / 1000 * Math.PI * 2 * 1.5);
      return {
        torso: { oy: -8 * b * e, sy: 1 + 0.03 * e },
        face: { oy: -8 * e, rot: -3 * e },
        // arms up in a V, pumping a little with the bounce
        armLUpper: { rot: (110 + 6 * b) * e },
        armLLower: { rot: 45 * e },
        armRUpper: { rot: -(110 + 6 * b) * e },
        armRLower: { rot: -45 * e },
      };
    },

    states(a) {
      if (a.envelope(300) < 0.3) return null;
      return a.ms < 800 ? { expression: 'happy', mouth: 'open' } : { expression: 'happy' };
    },

    inFront() { return chain(['armLUpper', 'armRUpper']); },

    front(a, g) {
      if (!a.settings.effects) return;
      const env = a.envelope(300);
      if (env <= 0) return;
      const n = Math.floor(a.ms / TWINKLE_MS), p = (a.ms % TWINKLE_MS) / TWINKLE_MS;
      const size = a.artSize('face').w || 200;
      const [hx, hy] = a.atArt(n % 2 ? 'armRLower' : 'armLLower', 0.5, 0.8);
      const dx = (hash(a.seed, n) - 0.5) * size * 0.8, dy = -(0.2 + hash(a.seed, n + 0.5) * 0.4) * size;
      const r = size * 0.12 * a.ease.bell(p);
      if (r <= 0.5) return;
      g.globalAlpha = env;
      g.fillStyle = '#fff3b0';
      sparkle(g, hx + dx, hy + dy, r);
      g.globalAlpha = 1;
    },
  });
})();
