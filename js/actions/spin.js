/* Spin: the avatar turns on the spot with a little hop, with speed arcs swirling behind it. */
PT.Actions.define({
  id: 'spin',
  label: 'Spin',
  duration: 1400,
  settings: [
    { key: 'turns', label: 'Turns', type: 'range', min: 1, max: 3, step: 1, default: 1 },
    { key: 'hop', label: 'Hop', type: 'range', min: 0, max: 150, step: 5, default: 100, suffix: '%' },
    { key: 'effects', label: 'Speed arcs', type: 'check', default: true },
  ],

  pose(a) {
    const lin = a.between(0.1, 0.9), u = a.ease.inOut(lin);
    let sx = Math.cos(2 * Math.PI * a.settings.turns * u);
    if (Math.abs(sx) < 0.02) sx = sx < 0 ? -0.02 : 0.02;   // never quite flat: a zero scale can't be inverted
    return { torso: { sx, oy: -60 * 4 * lin * (1 - lin) * a.settings.hop / 100 } };
  },

  behind(a, g) {
    if (!a.settings.effects) return;
    const p = a.between(0.1, 0.9);
    if (p <= 0 || p >= 1) return;
    const size = a.artSize('face').w || 200;
    const [cx, cy] = a.atArt('face', 0.5, 1.2);
    const r = size * 1.4, turn = 2 * Math.PI * a.settings.turns * a.ease.inOut(p);
    g.strokeStyle = `rgba(255, 255, 255, ${0.55 * a.ease.bell(p)})`;
    g.lineWidth = size * 0.04;
    g.lineCap = 'round';
    for (let i = 0; i < 3; i++) {
      const a0 = turn + (i * 2 * Math.PI) / 3;
      g.beginPath();
      g.ellipse(cx, cy + (i - 1) * size * 0.35, r, r * 0.3, 0, a0, a0 + 0.9);
      g.stroke();
    }
  },
});
