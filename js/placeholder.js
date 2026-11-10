/* Built-in placeholder art so the rig works before anything is uploaded.
   Each placeholder is drawn at exactly PT.LAYOUT[id].w x h so default positions line up. */
(function (PT) {
  const C = {
    line: '#2b2340', skin: '#f7d4bd', skinShade: '#e9b9a0', blush: 'rgba(255,120,140,.35)',
    shirt: '#7c6cf0', shirtShade: '#6656d8', hair: '#3b2e63', hairBack: '#2c2250',
    iris: '#4a8fe7', pupil: '#1b1530', mouth: '#7a2337', tongue: '#ff7a8a', white: '#ffffff',
  };
  const LW = 4;

  function canvas(id) {
    const L = PT.LAYOUT[id];
    const c = document.createElement('canvas');
    c.width = L.w; c.height = L.h;
    const ctx = c.getContext('2d');
    ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.lineWidth = LW; ctx.strokeStyle = C.line;
    return [c, ctx, L.w, L.h];
  }
  const fs = (ctx, fill) => { ctx.fillStyle = fill; ctx.fill(); ctx.stroke(); };
  function capsule(ctx, x, y, w, h) {
    const r = w / 2;
    ctx.beginPath();
    ctx.moveTo(x, y + r);
    ctx.arc(x + r, y + r, r, Math.PI, 0);
    ctx.lineTo(x + w, y + h - r);
    ctx.arc(x + r, y + h - r, r, 0, Math.PI);
    ctx.closePath();
  }

  const draw = {
    torso() {
      const [c, ctx, w, h] = canvas('torso');
      ctx.beginPath();
      ctx.moveTo(4, h);
      ctx.lineTo(10, 120);
      ctx.bezierCurveTo(14, 60, 60, 38, 130, 30);
      ctx.lineTo(270, 30);
      ctx.bezierCurveTo(340, 38, 386, 60, 390, 120);
      ctx.lineTo(396, h);
      ctx.closePath();
      fs(ctx, C.shirt);
      // collar (V)
      ctx.beginPath();
      ctx.moveTo(150, 31); ctx.lineTo(200, 110); ctx.lineTo(250, 31); ctx.closePath();
      fs(ctx, C.skin);
      ctx.beginPath(); ctx.moveTo(140, 31); ctx.lineTo(200, 124); ctx.lineTo(260, 31);
      ctx.lineWidth = 8; ctx.strokeStyle = C.shirtShade; ctx.stroke();
      return c;
    },
    neck() {
      const [c, ctx, w, h] = canvas('neck');
      ctx.beginPath(); ctx.rect(8, 0, w - 16, h); ctx.fillStyle = C.skin; ctx.fill();
      ctx.fillStyle = C.skinShade; ctx.fillRect(8, 0, w - 16, 34);
      ctx.beginPath(); ctx.moveTo(8, 0); ctx.lineTo(8, h); ctx.moveTo(w - 8, 0); ctx.lineTo(w - 8, h); ctx.stroke();
      return c;
    },
    face() {
      const [c, ctx, w, h] = canvas('face');
      ctx.beginPath();
      ctx.moveTo(w / 2, h - 6);
      ctx.bezierCurveTo(60, h - 10, 8, 230, 8, 150);
      ctx.bezierCurveTo(8, 50, 70, 6, w / 2, 6);
      ctx.bezierCurveTo(w - 70, 6, w - 8, 50, w - 8, 150);
      ctx.bezierCurveTo(w - 8, 230, w - 60, h - 10, w / 2, h - 6);
      fs(ctx, C.skin);
      ctx.fillStyle = C.blush;
      ctx.beginPath(); ctx.ellipse(62, 232, 26, 14, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(w - 62, 232, 26, 14, 0, 0, Math.PI * 2); ctx.fill();
      return c;
    },
    hairFront() {
      const [c, ctx] = canvas('hairFront');
      ctx.beginPath();
      ctx.moveTo(12, 190);
      ctx.bezierCurveTo(-4, 50, 90, 4, 165, 6);
      ctx.bezierCurveTo(240, 4, 334, 50, 318, 190);
      const pts = [[292, 140], [265, 178], [234, 128], [205, 170], [172, 118], [140, 168], [108, 124], [78, 172], [50, 132]];
      for (const [x, y] of pts) ctx.lineTo(x, y);
      ctx.closePath();
      fs(ctx, C.hair);
      ctx.strokeStyle = 'rgba(255,255,255,.18)'; ctx.lineWidth = 6;
      ctx.beginPath(); ctx.moveTo(95, 50); ctx.quadraticCurveTo(130, 30, 170, 32); ctx.stroke();
      return c;
    },
    hairBack() {
      const [c, ctx, w, h] = canvas('hairBack');
      ctx.beginPath();
      ctx.moveTo(26, h - 8);
      ctx.lineTo(10, 180);
      ctx.bezierCurveTo(10, 60, 90, 6, w / 2, 6);
      ctx.bezierCurveTo(w - 90, 6, w - 10, 60, w - 10, 180);
      ctx.lineTo(w - 26, h - 8);
      ctx.quadraticCurveTo(w / 2, h - 40, 26, h - 8);
      fs(ctx, C.hairBack);
      return c;
    },
    eyes(state) {
      const [c, ctx, w, h] = canvas('eyes');
      const centers = [[52, 35], [w - 52, 35]];
      for (const [x, y] of centers) {
        if (state === 'closed') {
          ctx.lineWidth = 5;
          ctx.beginPath(); ctx.moveTo(x - 28, y + 2); ctx.quadraticCurveTo(x, y + 20, x + 28, y + 2); ctx.stroke();
          continue;
        }
        ctx.save();
        ctx.beginPath(); ctx.ellipse(x, y, 28, 31, 0, 0, Math.PI * 2);
        ctx.fillStyle = C.white; ctx.fill();
        ctx.clip();
        ctx.fillStyle = C.iris; ctx.beginPath(); ctx.arc(x, y + 3, 19, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = C.pupil; ctx.beginPath(); ctx.arc(x, y + 3, 10, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = C.white; ctx.beginPath(); ctx.arc(x + 7, y - 5, 6, 0, Math.PI * 2); ctx.fill();
        if (state === 'half') { ctx.fillStyle = C.skin; ctx.fillRect(x - 32, y - 34, 64, 34); }
        ctx.restore();
        ctx.lineWidth = LW;
        ctx.beginPath(); ctx.ellipse(x, y, 28, 31, 0, 0, Math.PI * 2); ctx.stroke();
        if (state === 'half') {
          ctx.lineWidth = 5;
          ctx.beginPath(); ctx.moveTo(x - 29, y); ctx.lineTo(x + 29, y); ctx.stroke();
        }
      }
      return c;
    },
    mouth(state) {
      const [c, ctx, w, h] = canvas('mouth');
      const cx = w / 2, cy = h / 2;
      if (state === 'closed') {
        ctx.lineWidth = 5;
        ctx.beginPath(); ctx.moveTo(cx - 24, cy - 6); ctx.quadraticCurveTo(cx, cy + 12, cx + 24, cy - 6); ctx.stroke();
        return c;
      }
      const rx = state === 'half' ? 18 : 26, ry = state === 'half' ? 10 : 21;
      ctx.save();
      ctx.beginPath(); ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
      ctx.fillStyle = C.mouth; ctx.fill(); ctx.clip();
      ctx.fillStyle = C.tongue; ctx.beginPath(); ctx.ellipse(cx, cy + ry * 0.75, rx * 0.7, ry * 0.55, 0, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      ctx.beginPath(); ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2); ctx.stroke();
      return c;
    },
    upperArm(id) {
      const [c, ctx, w, h] = canvas(id);
      capsule(ctx, 4, 4, w - 8, h - 8);
      fs(ctx, C.shirt);
      return c;
    },
    lowerArm(id) {
      const [c, ctx, w, h] = canvas(id);
      capsule(ctx, 10, 4, w - 20, h - 40);
      fs(ctx, C.skin);
      ctx.beginPath(); ctx.arc(w / 2, h - 34, 30, 0, Math.PI * 2);
      fs(ctx, C.skin);
      return c;
    },
  };

  // Returns { partId: { state: canvas } }
  PT.makePlaceholders = () => ({
    torso: { main: draw.torso() },
    neck: { main: draw.neck() },
    face: { main: draw.face() },
    eyes: { open: draw.eyes('open'), half: draw.eyes('half'), closed: draw.eyes('closed') },
    mouth: { closed: draw.mouth('closed'), half: draw.mouth('half'), open: draw.mouth('open') },
    hairFront: { main: draw.hairFront() },
    hairBack: { main: draw.hairBack() },
    armLUpper: { main: draw.upperArm('armLUpper') },
    armLLower: { main: draw.lowerArm('armLLower') },
    armRUpper: { main: draw.upperArm('armRUpper') },
    armRLower: { main: draw.lowerArm('armRLower') },
  });
})(window.PT);
