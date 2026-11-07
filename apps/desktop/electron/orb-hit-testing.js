/** MOD-11 host-side DPI-aware transparent hit testing for the orb window.
 *
 * The orb is a 112×112 transparent window whose visible shell is a circle
 * (see src/features/orb/orb.js: core R = min(w,h)/2 × 0.52 × stateScale ×
 * breath, rim ×1.025). Every pixel outside that circle currently swallows
 * clicks meant for windows underneath. This module publishes the explicit
 * host capability: decide — per cursor sample, in DIP coordinates — whether
 * the orb must capture the cursor or forward events through its transparent
 * regions (win.setIgnoreMouseEvents), with hysteresis so the boundary does
 * not flap and safe defaults that never ignore when state is uncertain.
 *
 * DPI: Electron screen/cursor/bounds APIs are DIP-based, so the decision math
 * is resolution-independent; fractional-DPI rendering shifts are absorbed by
 * the hysteresis band. Display-metric changes reposition the orb (main.js)
 * and the next tick re-evaluates automatically.
 */

export const ORB_HIT_TESTING_REVISION = 1;

/** Hit-circle fraction of the half-minimum window side. Derivation (DIPs,
 * 112px window, worst case error state + audio level + breath + rim stroke):
 * visible radius ≤ 56 × 0.52 × 1.22 × 1.066 × 1.025 + 0.7 ≈ 39.3, so capture
 * must hold at ≤ 40 (= 0.75 × 56 − 2). Tunable; real-machine visual
 * acceptance is still pending (docs/modules/MOD-11-DPI-HIT-TESTING-20261107.md). */
export const ORB_HIT_FRACTION = 0.75;

/** Half-width of the hysteresis band in DIPs. */
export const ORB_HIT_HYSTERESIS = 2;

export const ORB_HIT_INTERVAL_MS = 80;

export function orbHitRadius(width, height, fraction = ORB_HIT_FRACTION) {
  if (!Number.isFinite(fraction) || fraction <= 0 || fraction >= 1) throw new RangeError('命中区域比例必须在 0 与 1 之间');
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return 0;
  return Math.min(width, height) / 2 * fraction;
}

/** Pure decision. `capture` true = orb takes the cursor; false = the window
 * forwards events (click-through over transparent regions). */
export function orbHitDecision({point, bounds, fraction, hysteresis = ORB_HIT_HYSTERESIS, capture: current = true} = {}) {
  const safe = {capture: true};
  const center = bounds && Number.isFinite(bounds.x) && Number.isFinite(bounds.y)
    && Number.isFinite(bounds.width) && Number.isFinite(bounds.height) ? bounds : undefined;
  if (!center) return {...safe, radius: 0, distance: null, reason: 'bounds-unavailable'};
  const radius = orbHitRadius(center.width, center.height, fraction);
  if (radius <= 0) return {...safe, radius, distance: null, reason: 'radius-unavailable'};
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return {...safe, radius, distance: null, reason: 'point-unavailable'};
  const distance = Math.hypot(point.x - (center.x + center.width / 2), point.y - (center.y + center.height / 2));
  if (distance <= radius - hysteresis) return {capture: true, radius, distance, reason: 'inside'};
  if (distance >= radius + hysteresis) return {capture: false, radius, distance, reason: 'outside'};
  return {capture: current, radius, distance, reason: 'hysteresis'};
}

/** Controller wiring the decision to a real BrowserWindow. All Electron
 * touchpoints are injected, so tests run headless with fakes. */
export function createOrbHitTestController({win, screen, isBusy, intervalMs = ORB_HIT_INTERVAL_MS, fraction, hysteresis, log} = {}) {
  let ignoring = false;
  let timer;
  let stopped = false;
  const setIgnore = value => {
    if (ignoring === value) return;
    win.setIgnoreMouseEvents(value, {forward: true});
    ignoring = value;
  };
  const capture = reason => {
    try { setIgnore(false); } catch { /* window may be gone; nothing to restore */ }
    return {capture: true, reason};
  };
  function evaluate() {
    if (stopped) return {capture: true, reason: 'stopped'};
    if (!win || typeof win.isDestroyed === 'function' && win.isDestroyed()) return capture('window-unavailable');
    if (typeof win.isVisible === 'function' && !win.isVisible()) return capture('window-hidden');
    if (typeof isBusy === 'function' && isBusy()) return capture('busy');
    try {
      const point = screen.getCursorScreenPoint();
      const bounds = typeof win.getContentBounds === 'function' ? win.getContentBounds() : win.getBounds();
      return orbHitDecision({point, bounds, fraction, hysteresis, capture: !ignoring});
    } catch (error) {
      if (log) try { log('orb-hit-test-error:' + (error instanceof Error ? error.message : String(error))); } catch { /* diagnostics never throw */ }
      return capture('sample-failed');
    }
  }
  function refresh() {
    const decision = evaluate();
    try { setIgnore(!decision.capture); } catch { /* window destroyed between evaluate and apply */ }
    return decision;
  }
  function start() {
    if (timer || stopped) return;
    timer = setInterval(refresh, intervalMs);
    if (typeof timer?.unref === 'function') timer.unref();
  }
  function stop() {
    stopped = true;
    if (timer) { clearInterval(timer); timer = undefined; }
    try { if (win && !(typeof win.isDestroyed === 'function' && win.isDestroyed())) setIgnore(false); } catch { /* window already gone */ }
  }
  return {refresh, start, stop, get ignoring() { return ignoring; }};
}
