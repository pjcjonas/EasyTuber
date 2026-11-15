/* Surprised: a jolt up with a pop, arms flicked out, eyes and mouth wide, a "!" above the head. */
PT.Actions.define({
  id: 'surprised',
  label: 'Surprised',
  duration: 1200,
  settings: [
    { key: 'strength', label: 'Strength', type: 'range', min: 0, max: 150, step: 5, default: 100, suffix: '%' },
    { key: 'effects', label: 'Exclamation mark', type: 'check', default: true },
  ],

  pose(a) {
    const amt = a.ease.outBack(a.between(0, 0.18)) * (1 - a.ease.inOut(a.between(0.7, 1)));
    const j = amt * a.settings.strength / 100;
    return {
      torso: { oy: -50 * j, sy: 1 + 0.04 * j, sx: 1 - 0.02 * j },
      face: { scale: 1 + 0.05 * j },
      // arms flick out to the sides, forearms bent up
      armLUpper: { rot: 45 * j },
      armLLower: { rot: 50 * j },
      armRUpper: { rot: -45 * j },
      armRLower: { rot: -50 * j },
    };
  },

  states(a) { return a.t < 0.85 ? { eyes: 'open', mouth: 'open' } : null; },

  front(a, g) {
    if (!a.settings.effects) return;
    const pop = a.ease.outBack(a.between(0.04, 0.24)), fade = 1 - a.between(0.75, 1);
    if (pop <= 0 || fade <= 0) return;
    const size = a.artSize('face').w || 200, px = Math.round(size * 0.5 * pop);
    if (px < 1) return;
    const [x, y] = a.atArt('face', 0.85, -0.05);
    g.globalAlpha = fade;
    g.font = `900 ${px}px sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'bottom';
    g.lineJoin = 'round';
    g.lineWidth = px * 0.1;
    g.strokeStyle = '#1a1a1a';
    g.fillStyle = '#ffde3b';
    g.strokeText('!', x, y);
    g.fillText('!', x, y);
    g.globalAlpha = 1;
  },
});
