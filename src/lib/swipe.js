// swipe.js — the horizontal page-turn gesture for touch devices.
//
// RTL reading order: the next page lies to the left, so dragging the page
// rightward advances it — the same motion as lifting the left-hand leaf of a
// Persian book. Leftward goes back. It mirrors the ←/→ arrow keys exactly.
//
// Listeners are passive and nothing is ever preventDefault()ed: vertical
// scrolling stays native, and a gesture that starts out vertical is abandoned
// on its first move.

const EDGE = 28;        // px — leave the system back-swipe gutters alone
const AXIS_LOCK = 10;   // px of travel before the axis is decided
const RATIO = 1.5;      // horizontal must beat vertical by this much

export const commitDistance = () => Math.max(56, window.innerWidth * 0.12);

// Resistance, so the page follows the finger without chasing it.
export const damp = (dx) => Math.sign(dx) * Math.min(Math.abs(dx) * 0.42, 60);

// onNext/onPrev return true when they navigated; anything else settles back.
export function bindSwipeNav(el, { onNext, onPrev, onDrag, onSettle, blocked }) {
  if (!el || !('ontouchstart' in window)) return () => {};

  let id = null;      // the finger we are following
  let x0 = 0, y0 = 0, dx = 0;
  let axis = null;

  const reset = () => { id = null; axis = null; dx = 0; };
  const finger = (list) => Array.from(list).find((t) => t.identifier === id);

  const start = (e) => {
    if (id !== null || e.touches.length > 1) return;
    const t = e.touches[0];
    if (t.clientX < EDGE || t.clientX > window.innerWidth - EDGE) return;
    if (e.target.closest?.('.track, .player')) return;
    if (blocked?.()) return;
    id = t.identifier;
    x0 = t.clientX;
    y0 = t.clientY;
    axis = null;
    dx = 0;
  };

  const move = (e) => {
    if (id === null) return;
    const t = finger(e.touches);
    if (!t) { reset(); return; }
    const ddx = t.clientX - x0;
    const ddy = t.clientY - y0;
    if (!axis) {
      if (Math.abs(ddx) < AXIS_LOCK && Math.abs(ddy) < AXIS_LOCK) return;
      // Scrolling wins ties: only a clearly horizontal drag turns a page.
      if (Math.abs(ddx) <= Math.abs(ddy) * RATIO) { reset(); return; }
      // A selection can appear mid-gesture (the «نقل» handles).
      if (blocked?.()) { reset(); return; }
      axis = 'x';
    }
    dx = ddx;
    onDrag?.(dx);
  };

  const end = (e) => {
    if (id === null) return;
    if (finger(e.touches)) return;          // some other finger lifted
    const d = axis === 'x' ? dx : 0;
    reset();
    if (Math.abs(d) >= commitDistance() && (d > 0 ? onNext : onPrev)?.() === true) return;
    if (d) onSettle?.();
  };

  const cancel = () => {
    const moved = axis === 'x';
    reset();
    if (moved) onSettle?.();
  };

  const opts = { passive: true };
  el.addEventListener('touchstart', start, opts);
  el.addEventListener('touchmove', move, opts);
  el.addEventListener('touchend', end, opts);
  el.addEventListener('touchcancel', cancel, opts);
  return () => {
    el.removeEventListener('touchstart', start, opts);
    el.removeEventListener('touchmove', move, opts);
    el.removeEventListener('touchend', end, opts);
    el.removeEventListener('touchcancel', cancel, opts);
  };
}
