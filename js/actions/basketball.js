/* Basketball: the avatar dribbles a ball, shoots at a hoop that appears beside it, scores, and goes wild.

   Everything is drawn here (no picture or sound files). The hoop goes on the side of the stage with
   more room, and the arm on that side dribbles and shoots. The ball is sized to the avatar's face.
   Arms with a forearm are bent at the shoulder and elbow so the hands reach where they should
   (both on the ball in front of the face, fists in the air), and from the catch on they are drawn
   in front of the head. An arm that is only a hand (no forearm image) is moved about instead, so
   the hand stays the right way up. */
(function () {
  // timeline, ms
  const BOUNCE = 520, BOUNCES = 5;
  const GATHER = BOUNCE * BOUNCES;       // 2600: catch the ball, crouch
  const SHOOT = GATHER + 550;            // 3150: rise and shoot
  const RELEASE = SHOOT + 350;           // 3500: the ball leaves the hand
  const FLIGHT = 900;
  const SCORE = RELEASE + FLIGHT;        // 4400: through the hoop
  const PARTY = SCORE + 100;             // 4500: going wild
  const DURATION = 8200;

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, u) => a + (b - a) * u;
  const ramp = (ms, from, len) => clamp((ms - from) / len, 0, 1);
  const GRAVITY = 2600;                  // stage units / s², for the ball after it drops through
  const CONFETTI = ['#ff4d6d', '#ffd23f', '#3ec1ff', '#7cf05a', '#b779ff', '#ff8c3a', '#ffffff'];

  /* Where things are: worked out once, on the first frame, from the avatar as it stands then. */
  function setup(a) {
    const s = a.state;
    if (s.ready) return s;
    const face = a.atArt('face', 0.5, 0.5), faceSize = a.artSize('face');
    const faceW = faceSize.w > 4 ? faceSize.w : 280, faceH = faceSize.h > 4 ? faceSize.h : 320;
    s.dir = face[0] < PT.STAGE_W / 2 ? 1 : -1;            // the hoop goes where there is more room
    s.side = s.dir > 0 ? 'R' : 'L';                         // the arm on that side of the screen
    s.out = s.dir > 0 ? -1 : 1;                             // rotation that lifts that arm outwards
    s.r = clamp(faceW * 0.2, 22, 70) * (a.settings.size / 100);
    s.rootScale = (a.project && a.project.root && a.project.root.scale) || 1;
    s.charH = faceH / s.rootScale;                         // the face's height in the avatar's own units
    const top = face[1] - faceH / 2;
    // each arm: a real arm (it has a forearm to swing), or only a hand
    const drawn = (id) => !!(a.project && a.project.parts[id] && a.project.parts[id].visible !== false && PT.Assets.hasUser && PT.Assets.hasUser(id));
    s.handOnly = {};
    for (const side of ['L', 'R']) s.handOnly[side] = !drawn('arm' + side + 'Lower') && drawn('arm' + side + 'Upper');
    // a hand-only arm moves this far to get from where it rests to the top of the head (avatar units)
    const hand = a.atArt('arm' + s.side + 'Upper', 0.5, 0.5);
    s.reach = Math.max(s.charH * 0.3, (hand[1] - top) / s.rootScale);
    s.rim = {
      x: clamp(face[0] + s.dir * Math.max(faceW * 3.2, 420), s.r * 4, PT.STAGE_W - s.r * 4),
      y: clamp(top - faceH * 0.15, s.r * 4.2, PT.STAGE_H * 0.45),
    };
    s.floor = PT.STAGE_H - s.r;
    s.face = face; s.faceW = faceW; s.faceH = faceH; s.top = top;
    // real arms: where the shoulder is, how long the upper arm and forearm are, which way they point
    s.arms = {};
    for (const sd of ['L', 'R']) {
      if (s.handOnly[sd]) continue;
      const up = 'arm' + sd + 'Upper', low = 'arm' + sd + 'Lower';
      const S = jointAt(a, up), E = jointAt(a, low), W = a.atArt(low, 0.5, 1);
      const L1 = Math.hypot(E[0] - S[0], E[1] - S[1]), L2 = Math.hypot(W[0] - E[0], W[1] - E[1]);
      if (L1 > 2 && L2 > 2) s.arms[sd] = { S, L1, L2, A1: Math.atan2(E[1] - S[1], E[0] - S[0]), A2: Math.atan2(W[1] - E[1], W[0] - E[0]), screen: sd === 'R' ? 1 : -1 };
    }
    s.ready = true;
    return s;
  }

  // a part's joint (its pivot) on the stage
  function jointAt(a, id) {
    const e = PT.Assets.primary(id, !!(a.project && a.project.stage.placeholders)), p = a.project && a.project.parts[id];
    if (!e || !p || !e.w || !e.h) return a.at(id, 0.5, 0.5);
    return a.at(id, p.px / e.w, p.py / e.h);
  }

  /* Bend a real arm so its hand reaches a point (stage units), elbow out to the side: returns
     [upper arm, forearm] rotations to add to the pose. If the point is out of reach the arm points
     at it. fallback: what to return for an arm that couldn't be measured. */
  function reachFor(s, sd, target, fallback) {
    const A = s.arms[sd];
    if (!A) return fallback;
    const dx = target[0] - A.S[0], dy = target[1] - A.S[1], d = Math.hypot(dx, dy) || 1;
    const dd = clamp(d, Math.abs(A.L1 - A.L2) + 1, A.L1 + A.L2 - 0.5);
    const base = Math.atan2(dy, dx), bend = Math.acos(clamp((A.L1 * A.L1 + dd * dd - A.L2 * A.L2) / (2 * A.L1 * dd), -1, 1));
    let best = null;
    for (const a1 of [base + bend, base - bend]) {
      const ex = A.S[0] + A.L1 * Math.cos(a1), ey = A.S[1] + A.L1 * Math.sin(a1), score = (ex - A.S[0]) * A.screen;
      if (!best || score > best.score) best = { a1, ex, ey, score };
    }
    const tx = A.S[0] + (dx / d) * dd, ty = A.S[1] + (dy / d) * dd;
    const a2 = Math.atan2(ty - best.ey, tx - best.ex), deg = 180 / Math.PI;
    // the same turn can be written many ways (+-360): keep the upper arm on its own side, so a
    // blend between two poses never swings the long way round
    const wrap = (v, centre) => v - 360 * Math.round((v - centre) / 360);
    const up = wrap((best.a1 - A.A1) * deg, -A.screen * 90);
    return [up, wrap((a2 - A.A2) * deg - up, 0)];
  }

  // where the ball sits in the hand: past the end of the forearm, along it. A hand-only arm holds
  // it below the hand (dribbling) or above it (shooting).
  function inHand(a, s, above = false) {
    if (s.handOnly[s.side]) {
      const c = a.atArt('arm' + s.side + 'Upper', 0.5, 0.5), sz = a.artSize('arm' + s.side + 'Upper');
      const gap = Math.max(sz.h * 0.45, s.r * 0.6) + s.r * 0.75;
      return [c[0], c[1] + (above ? -gap : gap)];
    }
    const id = 'arm' + s.side + 'Lower';
    const elbow = a.atArt(id, 0.5, 0), hand = a.atArt(id, 0.5, 1);
    let dx = hand[0] - elbow[0], dy = hand[1] - elbow[1];
    const len = Math.hypot(dx, dy);
    if (len < 1) { dx = 0; dy = 1; } else { dx /= len; dy /= len; }
    return [hand[0] + dx * s.r * 0.85, hand[1] + dy * s.r * 0.85];
  }

  /* The ball now: { x, y, spin, alpha, squash } or null */
  function ball(a, s) {
    const T = a.ms, r = s.r;
    if (T < GATHER) {                                       // dribbling: hand -> floor -> hand
      const p = (T % BOUNCE) / BOUNCE, h = inHand(a, s);
      const floor = Math.max(s.floor, h[1] + r * 1.5);
      const y = floor - (floor - h[1]) * Math.pow(2 * p - 1, 2);
      const near = Math.abs(p - 0.5) < 0.06 ? 1 - Math.abs(p - 0.5) / 0.06 : 0;
      return { x: h[0], y: y + near * r * 0.12, spin: T / 180, alpha: 1, squash: 1 - near * 0.15 };
    }
    if (T < RELEASE) {
      const h = s.held || inHand(a, s, T >= SHOOT);         // held: both hands have it (pose() says where)
      s.p0 = h;                                              // where it will leave the hand
      return { x: h[0], y: h[1], spin: T / 400, alpha: 1, squash: 1 };
    }
    const p0 = s.p0 || inHand(a, s, true), rim = s.rim, ty = rim.y - r * 0.15;
    // a high arc, but not off the top of the stage
    const H = clamp(Math.abs(rim.x - p0[0]) * 0.45, 120, Math.max(120, Math.min(p0[1], ty) - r * 1.6));
    if (T < SCORE) {                                        // the shot: up and over, into the hoop
      const u = (T - RELEASE) / FLIGHT;
      return { x: lerp(p0[0], rim.x, u), y: lerp(p0[1], ty, u) - 4 * H * u * (1 - u), spin: -s.dir * T / 90, alpha: 1, squash: 1 };
    }
    // through the net, then bouncing on the floor and rolling away
    const NET = 260, netEnd = rim.y + r * 2.4;
    if (T < SCORE + NET) {
      const u = (T - SCORE) / NET;
      return { x: rim.x, y: lerp(ty, netEnd, u * u * 0.6 + u * 0.4), spin: -s.dir * T / 90, alpha: 1, squash: 1 };
    }
    let x = rim.x, y = netEnd, vx = s.dir * r * 1.6, vy = 700;
    const dt = 1 / 120;
    for (let t = SCORE + NET; t < T; t += dt * 1000) {
      vy += GRAVITY * dt; x += vx * dt; y += vy * dt;
      if (y > s.floor) { y = s.floor - (y - s.floor) * 0.5; vy = -Math.abs(vy) * 0.55; vx *= 0.85; if (Math.abs(vy) < 90) vy = 0; }
    }
    return { x, y, spin: -s.dir * T / 90, alpha: 1 - ramp(T, 7300, 600), squash: 1 };
  }

  function drawBall(g, b, r) {
    if (!b || b.alpha <= 0) return;
    g.save();
    g.globalAlpha *= b.alpha;
    g.translate(b.x, b.y);
    g.scale(1 / Math.sqrt(b.squash), b.squash);
    g.rotate(b.spin);
    const grad = g.createRadialGradient(-r * 0.35, -r * 0.35, r * 0.1, 0, 0, r);
    grad.addColorStop(0, '#ffad5c'); grad.addColorStop(0.65, '#ee7a26'); grad.addColorStop(1, '#b64f12');
    g.fillStyle = grad;
    g.beginPath(); g.arc(0, 0, r, 0, Math.PI * 2); g.fill();
    // the seams
    g.strokeStyle = '#2a1608'; g.lineWidth = Math.max(1.5, r * 0.07); g.lineCap = 'round';
    g.beginPath(); g.moveTo(-r, 0); g.lineTo(r, 0); g.stroke();
    g.beginPath(); g.moveTo(0, -r); g.lineTo(0, r); g.stroke();
    g.beginPath(); g.arc(-r * 1.25, 0, r * 0.9, -0.85, 0.85); g.stroke();
    g.beginPath(); g.arc(r * 1.25, 0, r * 0.9, Math.PI - 0.85, Math.PI + 0.85); g.stroke();
    g.restore();
  }

  /* The hoop: backboard, rim and net. part = 'back' (board and back of the rim) or 'front'. */
  function drawHoop(g, a, s, part) {
    const T = a.ms, r = s.r, rim = s.rim;
    const show = Math.min(ramp(T, 0, 400), 1 - ramp(T, DURATION - 600, 600));
    if (show <= 0) return;
    const drop = (1 - a.ease.outBack(ramp(T, 0, 450))) * r * 1.5;
    // the rim shakes when the ball goes through
    const shake = T > SCORE ? Math.sin((T - SCORE) / 28) * Math.exp(-(T - SCORE) / 260) * r * 0.08 : 0;
    const x = rim.x, y = rim.y - drop + shake, rx = r * 1.75, ry = r * 0.36;
    g.save();
    g.globalAlpha *= show;
    g.lineCap = 'round'; g.lineJoin = 'round';
    if (part === 'back') {
      const bw = r * 5.8, top = y - r * 3.4, bh = r * 4.1;
      g.fillStyle = 'rgba(255,255,255,0.92)'; g.strokeStyle = '#3a3f4a'; g.lineWidth = r * 0.12;
      g.beginPath(); g.rect(x - bw / 2, top, bw, bh); g.fill(); g.stroke();
      g.strokeStyle = '#e8452c'; g.lineWidth = r * 0.1;
      g.strokeRect(x - r * 1.25, y - r * 1.75, r * 2.5, r * 1.75);
      g.fillStyle = '#7b818c'; g.fillRect(x - r * 0.35, y - r * 0.25, r * 0.7, r * 0.3);   // bracket
      g.strokeStyle = '#d4471b'; g.lineWidth = r * 0.17;
      g.beginPath(); g.ellipse(x, y, rx, ry, 0, Math.PI, Math.PI * 2); g.stroke();
    } else {
      // net: strings from the rim to a narrower ring below; it stretches and swings after a score
      const since = T - SCORE;
      const stretch = since > 0 ? 1 + 0.4 * Math.sin(Math.PI * clamp(since / 420, 0, 1)) : 1;
      const sway = since > 0 ? Math.sin(since / 90) * Math.exp(-since / 500) * r * 0.25 : 0;
      const depth = r * 2.4 * stretch, bx = x + sway, by = y + depth, brx = rx * 0.62;
      g.strokeStyle = 'rgba(255,255,255,0.95)'; g.lineWidth = Math.max(1.2, r * 0.05);
      const N = 10;
      for (let i = 0; i <= N; i++) {
        const t = Math.PI * (i / N);                      // the front half of the rim, left to right
        const tx = x - Math.cos(t) * rx, ty = y + Math.sin(t) * ry;
        const u = Math.PI * ((i + (i % 2 ? -0.5 : 0.5)) / N);
        const ex = bx - Math.cos(u) * brx, ey = by + Math.sin(u) * ry * 0.6;
        g.beginPath(); g.moveTo(tx, ty); g.quadraticCurveTo(lerp(tx, ex, 0.5) + sway * 0.3, lerp(ty, ey, 0.55), ex, ey); g.stroke();
      }
      for (const k of [0.35, 0.7, 1]) {
        g.beginPath(); g.ellipse(lerp(x, bx, k), lerp(y, by, k), lerp(rx, brx, k), ry * lerp(1, 0.6, k), 0, 0, Math.PI); g.stroke();
      }
      g.strokeStyle = '#ef5a24'; g.lineWidth = r * 0.17;
      g.beginPath(); g.ellipse(x, y, rx, ry, 0, 0, Math.PI); g.stroke();
    }
    g.restore();
  }

  // confetti made in start() from the run's seeded random numbers, so every page shows the same
  function makeConfetti(a) {
    const out = [];
    for (let i = 0; i < 110; i++) {
      const fromHoop = i < 70;
      out.push({
        fromHoop, at: fromHoop ? SCORE + 40 : PARTY + 350 + a.random() * 300,
        vx: (a.random() - 0.5) * (fromHoop ? 1300 : 1700), vy: -(450 + a.random() * (fromHoop ? 900 : 700)),
        spin: (a.random() - 0.5) * 18, w: 8 + a.random() * 10, h: 5 + a.random() * 6,
        color: CONFETTI[Math.floor(a.random() * CONFETTI.length)], wob: a.random() * 6.28, life: 2400 + a.random() * 1200,
      });
    }
    return out;
  }

  function drawConfetti(g, a, s) {
    if (!a.settings.confetti || !s.confetti) return;
    const T = a.ms, k = 1.6, grav = 1400, scale = clamp(s.r / 70, 0.6, 1.6);
    const head = s.head || [s.rim.x, s.rim.y];
    for (const c of s.confetti) {
      const t = (T - c.at) / 1000;
      if (t <= 0 || t * 1000 > c.life) continue;
      const e = (1 - Math.exp(-k * t)) / k;
      const x0 = c.fromHoop ? s.rim.x : head[0], y0 = c.fromHoop ? s.rim.y : head[1];
      const x = x0 + c.vx * e + Math.sin(t * 7 + c.wob) * 14;
      const y = y0 + (c.vy + grav / k) * e - (grav / k) * t;
      g.save();
      g.globalAlpha *= Math.min(1, (c.life - t * 1000) / 600);
      g.translate(x, y); g.rotate(c.spin * t + c.wob);
      g.scale(1, Math.cos(t * 9 + c.wob));                  // tumbling
      g.fillStyle = c.color;
      g.fillRect(-c.w * scale / 2, -c.h * scale / 2, c.w * scale, c.h * scale);
      g.restore();
    }
  }

  PT.Actions.define({
    id: 'basketball',
    label: 'Basketball',
    duration: DURATION,
    settings: [
      { key: 'size', label: 'Ball size', type: 'range', min: 50, max: 160, step: 5, default: 100, suffix: '%' },
      { key: 'confetti', label: 'Confetti', type: 'check', default: true },
    ],

    start(a) { a.state.confetti = makeConfetti(a); },

    pose(a) {
      const s = a.state;
      if (!s.ready) return null;                            // the first frame measures the avatar
      const T = a.ms, env = a.envelope(250, 500), out = s.out, dir = s.dir, H = s.charH;
      const side = s.side, otherSide = side === 'R' ? 'L' : 'R';
      const mix = (p, q, u) => p.map((v, k) => lerp(v, q[k], u));
      const sub = (p, q) => [p[0] - q[0], p[1] - q[1]];
      // Real arms: [upper arm, forearm] rotations, from where the hand should be (reachFor).
      // Hand-only arms: where the hand goes, as [outwards, upwards (1 = the top of the head), tilt].
      let arm = [0, 0], oArm = [0, 0], hand = [0, 0, 0], oHand = [0, 0, 0];
      let bodyY = 0, bodySy = 1, bodyRot = 0, headRot = 0, headY = 0, eyeX = 0, eyeY = 0;
      s.held = null;                                        // where the ball is while both hands have it

      // the ball held in front of the face, and the two hands on it: the throwing hand below and
      // behind, the other on its far side (stage units)
      const S = s.arms[side] ? s.arms[side].S : s.face, S2 = s.arms[otherSide] ? s.arms[otherSide].S : s.face;
      const shot = s.arms[side] ? s.arms[side] : null, guide = s.arms[otherSide] || null;
      const hands = (b) => [[b[0] + dir * s.r * 0.55, b[1] + s.r * 0.95], [b[0] - dir * s.r * 1.05, b[1] + s.r * 0.25]];
      // a ball both hands can reach: moved towards the shoulders until they can
      const mid = [lerp(S[0], S2[0], 0.5), lerp(S[1], S2[1], 0.5)];
      const fit = (b) => {
        for (let i = 0; i < 30; i++) {
          const [h1, h2] = hands(b);
          const ok = (A, h) => !A || Math.hypot(h[0] - A.S[0], h[1] - A.S[1]) <= (A.L1 + A.L2) * 0.92;
          if (ok(shot, h1) && ok(guide, h2)) break;
          b = [lerp(b[0], mid[0], 0.08), lerp(b[1], mid[1], 0.08)];
        }
        return b;
      };
      const reachLen = shot ? shot.L1 + shot.L2 : s.faceH * 0.5;
      const chest = fit([mid[0] + dir * s.faceW * 0.12, S[1] + reachLen * 0.12]);   // in front of the chest
      const forehead = fit([s.face[0] + dir * s.faceW * 0.12, s.top - s.r * 0.4]);  // just above the head, hands at the forehead
      // fully stretched towards the hoop, from the shoulder
      const towards = shot ? (() => { const d = sub([s.rim.x, s.rim.y], S), k = (shot.L1 + shot.L2) / Math.hypot(d[0], d[1]); return [S[0] + d[0] * k, S[1] + d[1] * k]; })() : forehead;
      const released = [towards[0] + (towards[0] - S[0]) * 0.18, towards[1] + (towards[1] - S[1]) * 0.18];   // the ball, just past the hand
      const letGo = [S2[0] - dir * s.r * 0.6, S2[1] - s.r * 0.6];   // where the guide hand goes once it has let go
      const fullArms = (main, other) => { arm = reachFor(s, side, main, arm); oArm = reachFor(s, otherSide, other, oArm); };

      if (T < GATHER) {                                     // dribble: arm out to the side, pumping
        const p = (T % BOUNCE) / BOUNCE, lift = Math.pow(2 * p - 1, 4);
        arm = [out * (26 + 5 * lift), out * (12 + 38 * lift)];
        hand = [0.15, 0.4 - 0.1 * (1 - lift), 8 * lift];        // up at the chest, so the bounce shows
        bodyY = H * 0.02 * Math.sin(Math.PI * 2 * p);
        headRot = dir * 3;                                   // watching the ball
        eyeX = dir * 4; eyeY = 5;
      } else if (T < SHOOT) {                               // catch it, bring it up to the chest, crouch
        const u = a.ease.inOut(ramp(T, GATHER, SHOOT - GATHER));
        const b = chest, [h1, h2] = hands(b);
        fullArms(h1, h2);
        arm = [lerp(out * 26, arm[0], u), lerp(out * 12, arm[1], u)];
        oArm = [oArm[0] * u, oArm[1] * u];
        s.held = shot ? mix(inHand(a, s), b, clamp((u - 0.2) / 0.6, 0, 1)) : null;   // the ball moves up with the hands
        hand = mix([0.15, 0.3, 8], [-0.25, 0.35, 0], u);
        oHand = mix([0, 0, 0], [-0.2, 0.3, 0], u);
        bodyY = H * 0.06 * u; bodySy = 1 - 0.02 * u;
        headRot = dir * 4 * u; eyeX = dir * 6 * u; eyeY = -4 * u;
      } else if (T < RELEASE + 400) {                       // up in front of the face, then push it to the hoop
        const lift = a.ease.inOut(ramp(T, SHOOT, 260));           // chest -> forehead
        const push = a.ease.outQuad(ramp(T, SHOOT + 260, RELEASE - SHOOT - 260));   // forehead -> arm stretched
        const flick = a.ease.outQuad(ramp(T, RELEASE, 250));
        const b = mix(chest, forehead, lift), bp = mix(b, released, push);
        const [h1, h2] = hands(b);
        // the guide hand lets go as the ball is pushed, and goes back to its own side (not across the face)
        const off = [letGo[0], letGo[1] + s.r * 2 * flick];
        const away = mix(h2, off, push);
        fullArms(mix(h1, towards, push), away);
        arm[1] += out * 25 * flick;                          // the wrist flicks towards the hoop
        s.held = T < RELEASE && shot ? bp : null;
        hand = mix(mix([-0.25, 0.35, 0], [-0.2, 0.8, 0], lift), [0.12, 1.05, 10], push); hand[2] += 22 * flick;
        oHand = mix(mix([-0.2, 0.3, 0], [-0.35, 0.75, 0], lift), [-0.1, 0.5, 0], push);
        const hop = Math.sin(Math.PI * ramp(T, SHOOT + 150, 650));
        bodyY = lerp(H * 0.06, 0, lift) - H * 0.08 * hop; bodySy = 1 + 0.02 * hop;
        headRot = dir * 7; headY = -H * 0.02; eyeX = dir * 8; eyeY = -8;
      } else {                                              // watch it go in ... then go wild
        const settle = a.ease.inOut(ramp(T, RELEASE + 400, PARTY - RELEASE - 400));
        fullArms(mix(towards, [S[0] + dir * (shot ? shot.L1 * 0.6 : 0), S[1] - (shot ? shot.L1 * 1.2 : 0)], settle),
          [letGo[0] - dir * s.r * 0.4 * settle, letGo[1] + s.r * (2 + 2 * settle)]);
        arm[1] += out * 25 * (1 - settle);
        hand = mix([0.12, 1.05, 32], [0.15, 0.75, 15], settle);
        oHand = mix([-0.1, 0.5, 0], [0.05, 0.4, 5], settle);
        headRot = dir * 7; headY = -H * 0.02; eyeX = dir * 8; eyeY = -8;
        const w = a.ease.outQuad(ramp(T, PARTY, 260)), c = T - PARTY;
        if (w > 0) {
          // fists pumping in the air: the hands go up and down above the shoulders, elbows out
          const jump = Math.abs(Math.sin(Math.PI * c / 620)), wave = Math.PI * 2 * c / 330;
          const pump = (sd, phase) => {
            const A = s.arms[sd];
            if (!A) return [0, 0];
            const L = A.L1 + A.L2, screen = sd === 'R' ? 1 : -1;
            return reachFor(s, sd, [A.S[0] + screen * L * (0.42 + 0.06 * Math.sin(wave + phase)), A.S[1] - L * (0.78 + 0.14 * Math.sin(wave + phase))], [0, 0]);
          };
          const p1 = pump(side, 0), p2 = pump(otherSide, Math.PI);
          arm = [lerp(arm[0], p1[0], w), lerp(arm[1], p1[1], w)];
          oArm = [lerp(oArm[0], p2[0], w), lerp(oArm[1], p2[1], w)];
          hand = mix(hand, [0.12 + 0.06 * Math.sin(wave), 0.85 + 0.12 * Math.sin(wave + 0.6), 14 * Math.sin(wave)], w);
          oHand = mix(oHand, [0.12 + 0.06 * Math.sin(wave + Math.PI), 0.85 + 0.12 * Math.sin(wave + Math.PI + 0.6), 14 * Math.sin(wave + Math.PI)], w);
          bodyY = -H * 0.09 * jump * w;
          bodySy = 1 + 0.03 * (jump - 0.5) * w;
          bodyRot = 4 * Math.sin(Math.PI * 2 * c / 620) * w;
          headRot = lerp(headRot, 10 * Math.sin(Math.PI * 2 * c / 400), w);
          headY = lerp(headY, -H * 0.02 * jump, w);
          eyeX = lerp(eyeX, 0, w); eyeY = lerp(eyeY, -3, w);
        }
      }
      const m = (v) => v * env;
      const result = {
        torso: { oy: m(bodyY), rot: m(bodyRot), sy: 1 + (bodySy - 1) * env },
        face: { rot: m(headRot), oy: m(headY) },
        eyes: { ox: m(eyeX * H / 300), oy: m(eyeY * H / 300) },
      };
      // one arm: swung, or (only a hand) moved. On the right of the screen, outwards is +x.
      const put = (sd, rot, h) => {
        const screen = sd === 'R' ? 1 : -1;
        if (s.handOnly[sd]) result['arm' + sd + 'Upper'] = { ox: m(screen * h[0] * s.reach), oy: m(-h[1] * s.reach), rot: m(screen * h[2]) };
        else { result['arm' + sd + 'Upper'] = { rot: m(rot[0]) }; result['arm' + sd + 'Lower'] = { rot: m(rot[1]) }; }
      };
      put(side, arm, hand);
      put(otherSide, oArm, oHand);
      return result;
    },

    // from the catch to the end, the arms are drawn in front of the head and body
    inFront(a) {
      if (a.ms < GATHER - 100 || !a.state.ready) return null;
      const ids = [];
      for (const sd of [a.state.side === 'R' ? 'L' : 'R', a.state.side]) ids.push('arm' + sd + 'Upper', 'arm' + sd + 'Lower');
      return ids;
    },

    states(a) {
      const T = a.ms;
      if (T >= PARTY) return { mouth: 'open', expression: 'happy' };   // a "happy" expression, if the avatar has one
      if (T >= RELEASE + 300) return { mouth: T > SCORE - 250 ? 'open' : 'half' };
      return {};
    },

    front(a, g) {
      const s = setup(a);
      if (a.ms >= PARTY && !s.head) { const f = a.atArt('face', 0.5, 0); s.head = [f[0], f[1] - s.r]; }
      drawHoop(g, a, s, 'back');
      drawBall(g, ball(a, s), s.r);
      drawHoop(g, a, s, 'front');
      drawConfetti(g, a, s);
    },
  });
})();
