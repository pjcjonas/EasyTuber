/* Builds the pose (world matrix per part) from the rig hierarchy and draws it to the canvas. */
(function (PT) {
  const { M } = PT;
  const ZERO = { ox: 0, oy: 0, rot: 0, sx: 1, sy: 1 };

  class Renderer {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.dpr = 1;
      this.stageMode = false;
      this.camMode = false;     // virtual camera: a camera picture can't be transparent
      this.checker = null;
    }

    resize() {
      const r = this.canvas.getBoundingClientRect();
      this.dpr = window.devicePixelRatio || 1;
      const w = Math.max(1, Math.round(r.width * this.dpr)), h = Math.max(1, Math.round(r.height * this.dpr));
      if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; }
    }

    // character space -> canvas pixels
    view() {
      const { width: w, height: h } = this.canvas;
      const pad = this.stageMode ? 0 : 28 * this.dpr;
      const k = Math.max(0.01, Math.min((w - pad * 2) / PT.STAGE_W, (h - pad * 2) / PT.STAGE_H));
      return M.mul(M.t((w - PT.STAGE_W * k) / 2, (h - PT.STAGE_H * k) / 2), M.s(k));
    }

    // whole-character transform: character space -> stage, scaled around the character's
    // bottom-center, which sits at the bottom-center of the stage
    rootMatrix(project) {
      const r = project.root;
      return M.chain(M.t(PT.STAGE_W / 2 + r.x, PT.STAGE_H + r.y), M.s(r.scale), M.t(-PT.CHAR_W / 2, -PT.CHAR_H));
    }

    static restMatrix(p) {
      return M.chain(M.t(p.x, p.y), M.r(p.rot), M.s(p.scale * (p.flip ? -1 : 1), p.scale), M.t(-p.px, -p.py));
    }

    /*
     * For each part: where its joint ends up after the parent's motion, plus its own motion.
     * Children inherit the parent's movement and rotation, but not its squash/stretch.
     *   delta = T(animatedJoint) * R(accumulatedRot) * S(ownScale) * T(-restJoint)
     *   world = view * root * delta * rest
     */
    computePose(project, deltas) {
      const base = M.mul(this.view(), this.rootMatrix(project));
      const pose = { base };
      for (const def of PT.PARTS) {
        const p = project.parts[def.id];
        const d = (deltas && deltas[def.id]) || ZERO;
        const parent = def.parent ? pose[def.parent] : null;
        const [jx, jy] = parent ? M.apply(parent.delta, p.x, p.y) : [p.x, p.y];
        const rotAcc = (parent ? parent.rotAcc : 0) + d.rot;
        const delta = M.chain(M.t(jx + d.ox, jy + d.oy), M.r(rotAcc), M.s(d.sx, d.sy), M.t(-p.x, -p.y));
        const rest = Renderer.restMatrix(p);
        pose[def.id] = { delta, rotAcc, rest, world: M.chain(base, delta, rest) };
      }
      return pose;
    }

    // Matrix for drawing a specific image entry of a part (handles mismatched state sizes + squash)
    // adj = optional per-frame fine-tune { dx, dy, s } (sprite sheet frames that don't line up exactly)
    entryMatrix(pose, partId, entry, squash, usePlaceholder, adj) {
      const prim = PT.Assets.primary(partId, usePlaceholder) || entry;
      let m = pose[partId].world;
      if (entry !== prim) m = M.mul(m, M.t((prim.w - entry.w) / 2, (prim.h - entry.h) / 2));
      if (adj && !entry.isPlaceholder && (adj.dx || adj.dy || (adj.s && adj.s !== 1))) {
        const cx = entry.w / 2, cy = entry.h / 2, s = adj.s || 1;
        m = M.chain(m, M.t(cx + (adj.dx || 0), cy + (adj.dy || 0)), M.s(s), M.t(-cx, -cy));
      }
      if (squash !== 1) {
        const cx = entry.bbox.x + entry.bbox.w / 2, cy = entry.bbox.y + entry.bbox.h / 2;
        m = M.chain(m, M.t(cx, cy), M.s(1, squash), M.t(-cx, -cy));
      }
      return m;
    }

    clear(project, editing) {
      const { ctx, canvas } = this;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const st = project.stage;
      const color = (st.bg === 'custom' ? st.color : PT.BG_COLORS[st.bg]) || (this.camMode ? '#000000' : null);

      if (this.stageMode) {
        if (color) { ctx.fillStyle = color; ctx.fillRect(0, 0, canvas.width, canvas.height); }
        return;
      }
      // editor: show the capture frame
      const v = this.view();
      const [x0, y0] = M.apply(v, 0, 0), [x1, y1] = M.apply(v, PT.STAGE_W, PT.STAGE_H);
      if (color) ctx.fillStyle = color;
      else {
        if (!this.checker) {
          const c = document.createElement('canvas'); c.width = c.height = 24;
          const g = c.getContext('2d');
          g.fillStyle = '#26232f'; g.fillRect(0, 0, 24, 24);
          g.fillStyle = '#1e1b27'; g.fillRect(0, 0, 12, 12); g.fillRect(12, 12, 12, 12);
          this.checker = ctx.createPattern(c, 'repeat');
        }
        ctx.fillStyle = this.checker;
      }
      ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
      if (editing) {
        ctx.strokeStyle = 'rgba(255,255,255,.18)'; ctx.lineWidth = 1;
        ctx.strokeRect(x0 + 0.5, y0 + 0.5, x1 - x0 - 1, y1 - y0 - 1);
      }
    }

    drawRig(project, pose, states, opts = {}) {
      const { ctx } = this;
      const usePH = project.stage.placeholders;
      const k = this.view()[0];   // stage units -> canvas pixels
      const now = performance.now();
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      for (const id of project.order) {
        const p = project.parts[id];
        if (!p.visible) continue;
        const def = PT.PART[id];
        const want = def.states.length > 1 ? (states[id] || def.states[0]) : 'main';
        const r = PT.Assets.resolve(id, want, usePH);
        if (!r) continue;
        const fx = opts.fx ? opts.fx(id, now) : null;   // avatar-switch animation and actions
        if (fx && fx.hide) continue;
        // onion skin: while lining up a frame, show the part's first frame faintly underneath
        if (!fx && opts.onionPart === id && !r.entry.isPlaceholder) {
          const refState = def.states.find((s) => s !== r.state && PT.Assets.user[id] && PT.Assets.user[id][s]);
          if (refState) {
            const ref = PT.Assets.user[id][refState];
            const rm = this.entryMatrix(pose, id, ref, 1, usePH, p.adj && p.adj[refState]);
            ctx.setTransform(rm[0], rm[1], rm[2], rm[3], rm[4], rm[5]);
            ctx.globalAlpha = 0.3;
            ctx.drawImage(ref.source, 0, 0, ref.w, ref.h);
          }
        }
        let m = this.entryMatrix(pose, id, r.entry, r.squash, usePH, p.adj && p.adj[r.state]);
        if (fx) {
          // move, spin and scale the part around its own centre, in screen space
          const bb = r.entry.bbox, [cx, cy] = M.apply(m, bb.x + bb.w / 2, bb.y + bb.h / 2);
          m = M.chain(M.t(cx + (fx.dx || 0) * k, cy + (fx.dy || 0) * k), M.r(fx.rot || 0), M.s(fx.scale ?? 1), M.t(-cx, -cy), m);
        }
        ctx.setTransform(m[0], m[1], m[2], m[3], m[4], m[5]);
        ctx.globalAlpha = (r.entry.isPlaceholder && opts.dimPlaceholders ? 0.55 : 1) * (fx ? fx.alpha ?? 1 : 1);
        ctx.drawImage(r.entry.source, 0, 0, r.entry.w, r.entry.h);
      }
      ctx.globalAlpha = 1;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    }

    // Topmost visible part under a canvas-pixel point (alpha-accurate)
    hitTest(project, pose, states, cx, cy) {
      const usePH = project.stage.placeholders;
      for (let i = project.order.length - 1; i >= 0; i--) {
        const id = project.order[i];
        if (!project.parts[id].visible) continue;
        const def = PT.PART[id];
        const r = PT.Assets.resolve(id, def.states.length > 1 ? (states[id] || def.states[0]) : 'main', usePH);
        if (!r) continue;
        const adj = project.parts[id].adj;
        const m = this.entryMatrix(pose, id, r.entry, r.squash, usePH, adj && adj[r.state]);
        const [u, v] = M.apply(M.inv(m), cx, cy);
        const e = r.entry;
        if (u < 0 || v < 0 || u >= e.w || v >= e.h) continue;
        const mx = Math.min(e.mask.w - 1, Math.floor(u / e.mask.sx)), my = Math.min(e.mask.h - 1, Math.floor(v / e.mask.sy));
        if (e.mask.alpha[my * e.mask.w + mx] > 24) return id;
      }
      return null;
    }
  }

  PT.Renderer = Renderer;
})(window.PT);
