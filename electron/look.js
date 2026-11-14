/* Where the mouse pointer is, for "eyes / head follow the mouse".

   While the editor asks for it, the desktop app reads the pointer about 30 times a second and
   tells every page where it is on its screen: x and y from -1 (left / top) to 1 (right / bottom).
   Only the position on the screen is used. Nothing is recorded, and nothing leaves the computer. */

const clamp = (v) => Math.max(-1, Math.min(1, v));

/* A pointer position on a display -> { x, y } in -1..1, to two decimals. */
function normalise(point, bounds) {
  if (!point || !bounds || !(bounds.width > 0) || !(bounds.height > 0)) return { x: 0, y: 0 };
  const r = (v) => Math.round(clamp(v) * 100) / 100 || 0;   // || 0: no -0
  return { x: r(((point.x - bounds.x) / bounds.width) * 2 - 1), y: r(((point.y - bounds.y) / bounds.height) * 2 - 1) };
}

/* A watcher: read() -> { point, bounds }, send({ x, y }) is called when the position has changed.
   set(true) starts it, set(false) stops it and sends the middle once, so the avatar looks ahead. */
function watcher(read, send, everyMs = 33) {
  let timer = null, last = '';
  const tick = () => {
    let pos;
    try { const got = read(); pos = normalise(got.point, got.bounds); } catch (e) { return; }
    const key = pos.x + ',' + pos.y;
    if (key === last) return;
    last = key;
    send(pos);
  };
  return {
    get on() { return !!timer; },
    tick,
    set(on) {
      if (on && !timer) { timer = setInterval(tick, everyMs); tick(); }
      if (!on && timer) { clearInterval(timer); timer = null; if (last && last !== '0,0') send({ x: 0, y: 0 }); last = ''; }
      return { on: !!timer };
    },
  };
}

module.exports = { normalise, watcher };
