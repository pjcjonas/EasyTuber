/* Hop: a crouch, a jump with a stretch, and a squashy landing with two dust puffs. */
PT.Actions.define({
  id: 'hop',
  label: 'Hop',
  duration: 900,
  settings: [
    { key: 'strength', label: 'Height', type: 'range', min: 0, max: 150, step: 5, default: 100, suffix: '%' },
    { key: 'effects', label: 'Dust puffs', type: 'check', default: true },
  ],

  pose(a) {
    const k = a.settings.strength / 100;
    const crouch = a.ease.bell(a.between(0, 0.22));
    const u = a.between(0.18, 0.62), air = 4 * u * (1 - u);   // a parabola: up and back down
    const land = a.ease.bell(a.between(0.6, 0.85));
    const rising = u > 0 && u < 0.5 ? air : 0;
    return {
      torso: {
        oy: (-120 * air + 20 * crouch + 14 * land) * k,
        sy: 1 + (-0.08 * crouch - 0.06 * land + 0.06 * rising) * k,
        sx: 1 + 0.05 * (crouch + land) * k,
      },
      armLUpper: { rot: 30 * air * k },
      armRUpper: { rot: -30 * air * k },
    };
  },

  front(a, g) {
    if (!a.settings.effects) return;
    const p = a.between(0.6, 0.95);
    if (p <= 0 || p >= 1) return;
    const size = a.artSize('face').w || 200;
    const [x, y] = a.atArt('torso', 0.5, 1);
    g.fillStyle = `rgba(225, 225, 225, ${0.55 * (1 - p)})`;
    for (const side of [-1, 1]) {
      const r = 0.16 * size * (0.5 + p);
      g.beginPath();
      g.ellipse(x + side * (0.3 + 0.5 * p) * size, y - 0.06 * size, r, r * 0.6, 0, 0, Math.PI * 2);
      g.fill();
    }
  },
});
