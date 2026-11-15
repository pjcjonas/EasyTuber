/* Shiver: a fast little tremble, arms pulled in, head sunk into the shoulders, cold wavy lines. */
PT.Actions.define({
  id: 'shiver',
  label: 'Shiver',
  duration: 2500,
  settings: [
    { key: 'strength', label: 'Strength', type: 'range', min: 0, max: 150, step: 5, default: 100, suffix: '%' },
    { key: 'effects', label: 'Cold lines', type: 'check', default: true },
  ],

  start(a) { a.state.phase = a.random() * 10; },

  pose(a) {
    const e = a.envelope(250, 350) * a.settings.strength / 100;
    const ph = a.state.phase || 0, ms = a.ms;
    const jit = Math.sin(ms * 0.09 + ph) + 0.6 * Math.sin(ms * 0.137 + ph * 1.7);
    return {
      torso: { ox: 6 * jit * e, rot: 0.4 * jit * e, sy: 1 - 0.02 * e },
      face: { oy: 6 * e, ox: 1.5 * jit * e },
      // arms hug the body: elbows in, forearms folded across
      armLUpper: { rot: (-10 + jit) * e },
      armLLower: { rot: -45 * e },
      armRUpper: { rot: (10 + jit) * e },
      armRLower: { rot: 45 * e },
    };
  },

  states(a) { return a.envelope(250, 350) > 0.2 ? { eyes: 'half', mouth: 'closed' } : null; },

  front(a, g) {
    if (!a.settings.effects) return;
    const env = a.envelope(250, 350);
    if (env <= 0) return;
    const size = a.artSize('face').w || 200;
    g.strokeStyle = `rgba(150, 210, 255, ${0.8 * env})`;
    g.lineWidth = size * 0.03;
    g.lineCap = 'round';
    for (const [u, side] of [[0, -1], [1, 1]]) {
      const [x0, y0] = a.atArt('face', u, 0.6);
      for (let i = 0; i < 3; i++) {
        const x = x0 + side * size * (0.2 + i * 0.12), y = y0 + (i - 1) * size * 0.12;
        g.beginPath();
        for (let s = 0; s <= 8; s++) {
          const yy = y - size * 0.15 + (s / 8) * size * 0.3;
          const xx = x + Math.sin(s * 1.6 + a.ms * 0.03 + i) * size * 0.025;
          if (s === 0) g.moveTo(xx, yy); else g.lineTo(xx, yy);
        }
        g.stroke();
      }
    }
  },
});
