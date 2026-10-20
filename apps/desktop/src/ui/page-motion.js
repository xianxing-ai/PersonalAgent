/** Presentation only: navigation stays synchronous and never waits for animation. */
export function mountPageMotion(element) {
  let previous, animation;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const stop = () => { animation?.cancel(); animation = undefined; };
  const calm = () => reduced.matches || document.documentElement.dataset.calm === 'true';
  const preferenceChanged = () => { if (calm()) stop(); };
  if (element.animate) {
    window.addEventListener('preferences-changed', preferenceChanged);
    reduced.addEventListener('change', preferenceChanged);
    window.addEventListener('unload', () => {
      stop();
      window.removeEventListener('preferences-changed', preferenceChanged);
      reduced.removeEventListener('change', preferenceChanged);
    }, {once: true});
  }
  return page => {
    if (page === previous) return;
    const initial = previous === undefined;
    previous = page;
    stop();
    element.scrollTop = 0;
    if (!initial && element.animate && !calm()) {
      animation = element.animate([{opacity: .72}, {opacity: 1}],
        {duration: 160, easing: 'cubic-bezier(.2,0,0,1)'});
    }
  };
}
