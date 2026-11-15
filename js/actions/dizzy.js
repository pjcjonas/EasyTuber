/* Dizzy: the head circles, the body wobbles, eyes half shut, and stars orbit above the head
   (the ones at the back of the orbit are drawn behind the avatar, the ones at the front in front). */
(function () {
  const REV_PER_S = 1.2;

  function star(g, x, y, r) {
    g.beginPath();
    for (let i = 0; i < 10; i++) {
      const ang = (i * Math.PI) / 5 - Math.PI / 2, rr = i % 2 ? r * 0.45 : r;
      g.lineTo(x + Math.cos(ang) * rr, y + Math.sin(ang) * rr);
    }
    g.closePath();
    g.fill();
    g.stroke();
  }

  // layer: 'behind' draws the stars at the back of the orbit, 'front' the ones at the front
  function stars(a, g, layer) {
    if (!a.settings.effects) return;
    const env = a.envelope(300, 500);
    if (env <= 0) return;
    const size = a.artSize('face').w || 200;
    const [cx, top] = a.atArt('face', 0.5, 0);
    const cy = top - size * 0.1, rx = size * 0.55, ry = rx * 0.25;
    const n = a.settings.stars, spin = a.ms / 1000 * Math.PI * 2 * REV_PER_S;
    g.globalAlpha = env;
    g.fillStyle = '#ffe14d';
    g.strokeStyle = '#b8860b';
    g.lineWidth = size * 0.012;
    g.lineJoin = 'round';
    for (let i = 0; i < n; i++) {
      const th = spin + (i * 2 * Math.PI) / n, near = Math.sin(th) > 0;
      if (near !== (layer === 'front')) continue;
      star(g, cx + rx * Math.cos(th), cy + ry * Math.sin(th), size * 0.09 * (0.85 + 0.15 * Math.sin(th)));
    }
    g.globalAlpha = 1;
  }

  PT.Actions.define({
    id: 'dizzy',
    label: 'Dizzy',
    duration: 3000,
    settings: [
      { key: 'strength', label: 'Strength', type: 'range', min: 0, max: 150, step: 5, default: 100, suffix: '%' },
      { key: 'stars', label: 'How many stars', type: 'range', min: 3, max: 5, step: 1, default: 4 },
      { key: 'effects', label: 'Show stars', type: 'check', default: true },
    ],

    pose(a) {
      const e = a.envelope(300, 500) * a.settings.strength / 100;
      const ang = a.ms / 1000 * Math.PI * 2 * REV_PER_S, slow = ang * 0.5 + 1;
      return {
        face: { rot: 8 * Math.sin(ang) * e, ox: 14 * Math.cos(ang) * e, oy: 6 * Math.sin(ang) * e },
        torso: { rot: 3 * Math.sin(slow) * e, ox: 10 * Math.cos(slow) * e },
        armLUpper: { rot: 8 * Math.cos(slow) * e },
        armRUpper: { rot: 8 * Math.cos(slow) * e },
      };
    },

    states(a) { return a.envelope(300, 500) > 0.3 ? { eyes: 'half' } : null; },

    behind(a, g) { stars(a, g, 'behind'); },
    front(a, g) { stars(a, g, 'front'); },
  });
})();
