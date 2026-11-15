/* Headbang: fast nods that snap down and ease back, eyes shut, mouth open, impact lines on the beat. */
(function () {
  const BANGS_PER_S = 3;

  // 0 -> 1 quickly (the snap down), then back to 0 more slowly, once per beat
  function down(a, x) { return x < 0.3 ? a.ease.outQuad(x / 0.3) : 1 - a.ease.inOut((x - 0.3) / 0.7); }

  PT.Actions.define({
    id: 'headbang',
    label: 'Headbang',
    duration: 2400,
    settings: [
      { key: 'strength', label: 'Strength', type: 'range', min: 0, max: 150, step: 5, default: 100, suffix: '%' },
      { key: 'effects', label: 'Impact lines', type: 'check', default: true },
    ],

    pose(a) {
      const e = a.envelope(200, 300) * a.settings.strength / 100;
      const beat = a.ms / 1000 * BANGS_PER_S, d = down(a, beat % 1);
      const tilt = Math.floor(beat) % 2 ? 1 : -1;
      return {
        face: { oy: 22 * d * e, rot: 8 * tilt * d * e, sy: 1 - 0.05 * d * e },
        torso: { oy: 10 * d * e, rot: 3 * tilt * d * e },
        armLUpper: { rot: 6 * d * e },
        armRUpper: { rot: -6 * d * e },
      };
    },

    states(a) {
      if (a.envelope(200, 300) < 0.3) return null;
      return { eyes: 'closed', mouth: 'open' };
    },

    front(a, g) {
      if (!a.settings.effects) return;
      const x = (a.ms / 1000 * BANGS_PER_S) % 1;
      if (x < 0.22 || x > 0.6) return;
      const p = (x - 0.22) / 0.38, size = a.artSize('face').w || 200;
      const [cx, cy] = a.atArt('face', 0.5, 0.15);
      const alpha = (1 - p) * a.envelope(200, 300);
      g.lineCap = 'round';
      for (const [color, width] of [['rgba(0, 0, 0, 0.35)', 0.06], ['#ffffff', 0.03]]) {
        g.strokeStyle = color;
        g.lineWidth = size * width;
        g.globalAlpha = alpha;
        for (const side of [-1, 1]) {
          for (let i = 0; i < 3; i++) {
            const ang = side * (0.5 + i * 0.35) - Math.PI / 2;
            const r0 = size * (0.6 + 0.15 * p), r1 = r0 + size * 0.22;
            g.beginPath();
            g.moveTo(cx + Math.cos(ang) * r0, cy + Math.sin(ang) * r0);
            g.lineTo(cx + Math.cos(ang) * r1, cy + Math.sin(ang) * r1);
            g.stroke();
          }
        }
      }
      g.globalAlpha = 1;
    },
  });
})();
