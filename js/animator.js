/* The pre-configured motion: breathing, idle sway, blinking, lip-sync, head bob/tilt,
   arm gestures and hair follow-through. Produces per-part offsets each frame. */
(function (PT) {
  const { Spring, clamp, approach } = PT;
  const rnd = (a, b) => a + Math.random() * (b - a);

  class Animator {
    constructor() {
      this.t = 0;
      this.breath = Math.random() * Math.PI * 2;
      this.vol = 0;                  // smoothed "how much am I talking" 0..1

      // springs give the motion weight and overshoot
      this.bodyY = new Spring(140, 14);
      this.headY = new Spring(260, 15);
      this.headTilt = new Spring(90, 11);
      this.hairFront = new Spring(110, 7);
      this.hairBack = new Spring(70, 5);
      this.hairStretch = new Spring(160, 9);
      this.gest = { 1: new Spring(60, 10), [-1]: new Spring(60, 10) };
      this.fore = { 1: new Spring(80, 8), [-1]: new Spring(80, 8) };

      this.prevHeadRot = 0; this.prevHeadY = 0;

      // blink
      this.eyes = 'open';
      this.blinkSeq = null; this.blinkStep = 0; this.blinkTimer = 0;
      this.nextBlink = rnd(1.5, 4);

      // mouth
      this.mouth = 'closed';
      this.lastLoud = -10; this.heldMouth = 'half'; this.mouthChanged = 0;
    }

    blink() {
      const seq = [['half', 0.045], ['closed', 0.09], ['half', 0.05]];
      if (Math.random() < this.doubleBlinkChance) seq.push(['open', 0.1], ['half', 0.04], ['closed', 0.08], ['half', 0.05]);
      this.blinkSeq = seq; this.blinkStep = 0; this.blinkTimer = 0;
    }

    update(dt, level, motion, mic) {
      dt = Math.min(dt, 0.1);
      const t = (this.t += dt);
      const m = motion;
      this.doubleBlinkChance = m.doubleBlink;

      /* ---------- talking ---------- */
      const talkThr = mic.talk, openThr = Math.max(mic.open, mic.talk + 0.01);
      const loud = level >= talkThr;
      const target = loud ? 0.35 + 0.65 * clamp((level - talkThr) / (1 - talkThr), 0, 1) : 0;
      this.vol = approach(this.vol, target, target > this.vol ? 25 : 6, dt);
      const v = this.vol;

      // mouth state with hold time + anti-flicker
      let want = level >= openThr ? 'open' : loud ? 'half' : 'closed';
      if (want !== 'closed') { this.lastLoud = t; this.heldMouth = want; }
      else if ((t - this.lastLoud) * 1000 < mic.hold) want = this.heldMouth === 'open' ? 'half' : this.heldMouth;
      if (want !== this.mouth && t - this.mouthChanged > 0.055) {
        if (this.mouth === 'closed' && want !== 'closed') {
          // syllable onset: little head hop
          this.headY.v -= 140 * m.headBob;
          this.bodyY.v -= 40 * m.bodyBounce;
        }
        this.mouth = want; this.mouthChanged = t;
      }

      /* ---------- breathing ---------- */
      this.breath += dt * (Math.PI * 2) / Math.max(0.5, m.breathSpeed);
      const b = Math.sin(this.breath);           // -1 exhale .. +1 inhale
      const A = m.breathAmount;

      /* ---------- blinking ---------- */
      if (this.blinkSeq) {
        this.blinkTimer += dt;
        while (this.blinkSeq && this.blinkTimer >= this.blinkSeq[this.blinkStep][1]) {
          this.blinkTimer -= this.blinkSeq[this.blinkStep][1];
          this.blinkStep++;
          if (this.blinkStep >= this.blinkSeq.length) {
            this.blinkSeq = null;
            this.nextBlink = t + Math.max(0.6, m.blinkInterval * rnd(0.45, 1.55));
          }
        }
        this.eyes = this.blinkSeq ? this.blinkSeq[this.blinkStep][0] : 'open';
      } else {
        this.eyes = 'open';
        if (t >= this.nextBlink) this.blink();
      }

      /* ---------- body ---------- */
      const bodyY = this.bodyY.step(-v * 9 * m.bodyBounce, dt);
      const torso = { ox: 0, oy: bodyY, rot: Math.sin(t * 0.37) * 0.35 * m.idleSway, sx: 1 - 0.005 * A * b, sy: 1 + 0.018 * A * b };
      const neck = { ox: 0, oy: 0, rot: 0, sx: 1, sy: 1 + 0.01 * A * b };

      /* ---------- head ---------- */
      const idle = (Math.sin(t * 0.53) * 1.1 + Math.sin(t * 0.29 + 1.3) * 0.7) * m.idleSway;
      const tilt = this.headTilt.step(v * m.headTilt * 6 * Math.sin(t * 1.7) + v * m.headTilt * 1.5, dt);
      const headY = this.headY.step(-v * 10 * m.headBob - b * 1.5 * A, dt);
      const headRot = idle + tilt;
      const face = { ox: Math.sin(t * 0.41) * 1.5 * m.idleSway, oy: headY, rot: headRot, sx: 1, sy: 1 };

      // head velocities drive the hair
      const rotVel = (headRot - this.prevHeadRot) / Math.max(dt, 1e-3);
      const yVel = (headY - this.prevHeadY) / Math.max(dt, 1e-3);
      this.prevHeadRot = headRot; this.prevHeadY = headY;

      /* ---------- hair (follow-through) ---------- */
      const H = m.hairPhysics;
      this.hairFront.v += -rotVel * 0.05 * H * dt * 60;
      this.hairBack.v += -rotVel * 0.09 * H * dt * 60;
      this.hairStretch.v += yVel * 0.0009 * H * dt * 60;
      const hf = this.hairFront.step(0, dt), hb = this.hairBack.step(Math.sin(t * 1.1) * 0.5 * H, dt);
      const hs = clamp(this.hairStretch.step(0, dt), -0.06, 0.06);
      const hairFront = { ox: 0, oy: 0, rot: clamp(hf, -6, 6), sx: 1, sy: 1 + hs * 0.6 };
      const hairBack = { ox: 0, oy: 0, rot: clamp(hb, -8, 8), sx: 1, sy: 1 + hs };

      /* ---------- face features ---------- */
      const eyes = { ox: 0, oy: 0, rot: 0, sx: 1, sy: 1 };
      const mouthSq = this.mouth === 'open' ? 1 + clamp((level - openThr) * 0.5, 0, 0.15) : 1;
      const mouth = { ox: 0, oy: 0, rot: 0, sx: 1, sy: mouthSq };

      /* ---------- arms ---------- */
      const out = { torso, neck, face, hairFront, hairBack, eyes, mouth };
      for (const s of [1, -1]) {
        const ph = s === 1 ? 0 : 2.1;
        const sway = (Math.sin(t * 0.8 + ph) * 1.3 + b * 0.9 * A) * m.armSway;
        const g = this.gest[s].step(v * m.gesture * 9 * (0.55 + 0.45 * Math.sin(t * 1.6 + ph)), dt);
        const upper = sway + g;
        const fore = this.fore[s].step(g * 0.8 + v * m.gesture * 6 * Math.sin(t * 2.3 + ph) + Math.sin(t * 1.05 + ph) * 0.8 * m.armSway, dt);
        out[s === 1 ? 'armLUpper' : 'armRUpper'] = { ox: 0, oy: 0, rot: s * upper, sx: 1, sy: 1 };
        // forearm bends inward (toward the body) as it gestures
        out[s === 1 ? 'armLLower' : 'armRLower'] = { ox: 0, oy: 0, rot: -s * fore, sx: 1, sy: 1 };
      }

      return { deltas: out, states: { eyes: this.eyes, mouth: this.mouth }, vol: v, level };
    }
  }

  PT.Animator = Animator;
})(window.PT);
