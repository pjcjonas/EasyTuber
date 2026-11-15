/* Dance: a side-to-side sway on the beat with a bounce, arms up in turn, music notes floating up. */
(function () {
  const BPM = 120, NOTES = ['♪', '♫'];

  PT.Actions.define({
    id: 'dance',
    label: 'Dance',
    duration: 4000,
    settings: [
      { key: 'strength', label: 'Strength', type: 'range', min: 0, max: 150, step: 5, default: 100, suffix: '%' },
      { key: 'effects', label: 'Music notes', type: 'check', default: true },
    ],

    start(a) {
      a.state.notes = Array.from({ length: 7 }, (_, i) => ({
        t0: 0.06 + i * 0.12, side: i % 2 ? 1 : -1, glyph: NOTES[i % 2], drift: (a.random() - 0.5) * 0.4,
      }));
    },

    pose(a) {
      const e = a.envelope(300, 400) * a.settings.strength / 100;
      const beat = a.ms / 1000 * (BPM / 60);
      const sway = Math.sin(Math.PI * beat), bounce = Math.abs(sway);
      return {
        torso: { ox: 40 * sway * e, oy: -18 * bounce * e, rot: 6 * sway * e },
        face: { rot: -5 * sway * e, oy: 8 * Math.cos(2 * Math.PI * beat) * e },
        // the arm on the side the body sways away from goes up, bent at the elbow
        armLUpper: { rot: (15 + 75 * Math.max(0, -sway)) * e },
        armLLower: { rot: (10 + 60 * Math.max(0, -sway)) * e },
        armRUpper: { rot: -(15 + 75 * Math.max(0, sway)) * e },
        armRLower: { rot: -(10 + 60 * Math.max(0, sway)) * e },
      };
    },

    front(a, g) {
      if (!a.settings.effects || !a.state.notes) return;
      const size = a.artSize('face').w || 200, env = a.envelope(300, 400);
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.font = `bold ${Math.round(size * 0.35)}px "Segoe UI Symbol", "Noto Music", sans-serif`;
      for (const n of a.state.notes) {
        const p = a.between(n.t0, n.t0 + 0.3);
        if (p <= 0 || p >= 1) continue;
        const [x, y] = a.atArt('face', n.side > 0 ? 1.1 : -0.1, 0.3);
        g.globalAlpha = env * Math.min(1, 4 * p) * (1 - p);
        g.fillStyle = n.side > 0 ? '#ff7ac8' : '#7ad7ff';
        g.fillText(n.glyph, x + (n.side * 0.15 + n.drift) * size * p, y - 0.9 * size * p);
      }
      g.globalAlpha = 1;
    },
  });
})();
