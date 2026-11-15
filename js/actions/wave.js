/* Wave: the right hand goes up and waves three times, the head tilts towards it, motion marks by the hand. */
(function () {
  // the right arm and everything hanging from it (the user's own hand part), parents first
  function chain(roots) {
    const ids = new Set(roots);
    for (const d of PT.PARTS) if (d.parent && ids.has(d.parent)) ids.add(d.id);
    return [...ids];
  }

  // -1 .. 1, three times side to side in the middle of the run, 0 before and after
  function swing(a) { return Math.sin(2 * Math.PI * 3 * a.between(0.15, 0.85)); }

  PT.Actions.define({
    id: 'wave',
    label: 'Wave',
    duration: 2200,
    settings: [
      { key: 'strength', label: 'Strength', type: 'range', min: 0, max: 150, step: 5, default: 100, suffix: '%' },
      { key: 'effects', label: 'Motion marks', type: 'check', default: true },
    ],

    pose(a) {
      const up = a.envelope(300, 400) * a.settings.strength / 100, s = swing(a);
      return {
        // the shoulder lifts the arm out to the side, the forearm points up and swings from the elbow
        armRUpper: { rot: -95 * up },
        armRLower: { rot: (-65 + 28 * s) * up },
        face: { rot: 4 * up },
      };
    },

    inFront() { return chain(['armRUpper']); },

    front(a, g) {
      if (!a.settings.effects) return;
      const s = swing(a), alpha = 0.7 * Math.abs(s) * a.envelope(300, 400);
      if (alpha <= 0.02) return;
      const size = a.artSize('face').w || 200;
      const [hx, hy] = a.atArt('armRLower', 0.5, 0.8);
      g.lineCap = 'round';
      for (const [color, width] of [['rgba(0, 0, 0, 0.3)', 0.05], ['#ffffff', 0.025]]) {
        g.strokeStyle = color;
        g.lineWidth = size * width;
        g.globalAlpha = alpha;
        for (const side of [-1, 1]) {
          for (let i = 0; i < 2; i++) {
            const r = size * (0.32 + i * 0.12), mid = side > 0 ? 0 : Math.PI;
            g.beginPath();
            g.arc(hx, hy, r, mid - 0.45, mid + 0.45);
            g.stroke();
          }
        }
      }
      g.globalAlpha = 1;
    },
  });
})();
