/* Cheer: both arms up, two hops, a happy face, and sparkles bursting from the hands. */
(function () {
  // the arm parts and everything hanging from them (the user's own hand parts), parents first
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

  const BURSTS = [0.2, 0.45, 0.7];

  PT.Actions.define({
    id: 'cheer',
    label: 'Cheer',
    duration: 2400,
    settings: [
      { key: 'strength', label: 'Strength', type: 'range', min: 0, max: 150, step: 5, default: 100, suffix: '%' },
      { key: 'effects', label: 'Sparkles', type: 'check', default: true },
    ],

    start(a) {
      // where each sparkle flies, chosen once so every page draws the same burst
      a.state.sparks = BURSTS.map(() => [0, 1].map(() => Array.from({ length: 5 }, () => ({
        ang: -Math.PI / 2 + (a.random() - 0.5) * 2.2, dist: 0.5 + a.random() * 0.6, size: 0.6 + a.random() * 0.6,
      }))));
    },

    pose(a) {
      const k = a.settings.strength / 100, up = a.envelope(250, 350) * k;
      const pump = Math.sin(a.ms / 1000 * Math.PI * 2 * 3) * 10 * up;
      const u = a.between(0.15, 0.85) * 2, f = u % 1, hop = u >= 2 ? 0 : 4 * f * (1 - f);
      return {
        torso: { oy: -70 * hop * k },
        // arms up in a V: the shoulder turns them up and out, the elbow bends the forearm on up
        armLUpper: { rot: 100 * up + pump },
        armLLower: { rot: 60 * up },
        armRUpper: { rot: -100 * up + pump },
        armRLower: { rot: -60 * up },
      };
    },

    states(a) {
      if (a.t < 0.05 || a.t > 0.95) return null;
      return { eyes: 'half', mouth: 'open', expression: 'happy' };
    },

    inFront() { return chain(['armLUpper', 'armRUpper']); },

    front(a, g) {
      if (!a.settings.effects || !a.state.sparks) return;
      const size = a.artSize('face').w || 200;
      g.fillStyle = '#ffd54a';
      BURSTS.forEach((t0, b) => {
        const p = a.between(t0, t0 + 0.25);
        if (p <= 0 || p >= 1) return;
        ['armLLower', 'armRLower'].forEach((arm, h) => {
          const [x, y] = a.atArt(arm, 0.5, 1);
          g.globalAlpha = 1 - p;
          for (const s of a.state.sparks[b][h]) {
            const d = s.dist * size * a.ease.outQuad(p);
            sparkle(g, x + Math.cos(s.ang) * d, y + Math.sin(s.ang) * d, 0.08 * size * s.size * (1 - 0.5 * p));
          }
        });
      });
      g.globalAlpha = 1;
    },
  });
})();
