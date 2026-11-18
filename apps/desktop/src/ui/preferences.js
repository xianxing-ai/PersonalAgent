const systemTheme = matchMedia('(prefers-color-scheme: dark)');
const systemMotion = matchMedia('(prefers-reduced-motion: reduce)');
const VALID_ORB_VARIANTS = ['particle', 'matrix', 'orbit', 'wire', 'glass', 'aura', 'ink', 'pulse'];
const VALID_ORB_STATES = ['idle', 'listening', 'thinking', 'executing', 'waiting', 'error'];

function readStorage(key) {
  try { return typeof localStorage !== 'undefined' ? localStorage.getItem(key) : null; }
  catch { return null; }
}

export function themePreference() {
  const saved = readStorage('pa-theme');
  return saved === 'system' ? 'system' : saved === 'light' ? 'light' : 'dark';
}

export function orbVariantPreference() {
  const saved = readStorage('pa-orb-variant');
  return VALID_ORB_VARIANTS.includes(saved) ? saved : 'matrix';
}

export function orbStateOverride() {
  const saved = readStorage('pa-orb-state-override');
  return VALID_ORB_STATES.includes(saved) ? saved : null;
}

export function applyPreferences() {
  const preference = themePreference();
  if (typeof document !== 'undefined' && document.documentElement?.dataset) {
    document.documentElement.dataset.theme = preference === 'system' ? (systemTheme.matches ? 'dark' : 'light') : preference;
    document.documentElement.dataset.calm = String(systemMotion.matches || readStorage('pa-calm') === 'true');
    document.documentElement.dataset.orbVariant = orbVariantPreference();
    document.documentElement.dataset.orbStateOverride = orbStateOverride() ?? 'auto';
  }
  window.dispatchEvent?.(new Event('preferences-changed'));
}

export function saveTheme(value) {
  if (!['system', 'dark', 'light'].includes(value)) return;
  try { localStorage.setItem('pa-theme', value); } catch {}
  applyPreferences();
}

export function saveCalm(value) {
  try { localStorage.setItem('pa-calm', String(Boolean(value))); } catch {}
  applyPreferences();
}

export function saveOrbVariant(value) {
  if (!VALID_ORB_VARIANTS.includes(value)) return;
  try { localStorage.setItem('pa-orb-variant', value); } catch {}
  applyPreferences();
}

export function saveOrbStateOverride(value) {
  try {
    if (!value || value === 'auto' || !VALID_ORB_STATES.includes(value)) {
      localStorage.removeItem('pa-orb-state-override');
    } else {
      localStorage.setItem('pa-orb-state-override', value);
    }
  } catch {}
  applyPreferences();
}

window.addEventListener('storage', event => {
  if (!event.key || ['pa-theme', 'pa-calm', 'pa-orb-variant', 'pa-orb-state-override'].includes(event.key)) applyPreferences();
});
systemTheme.addEventListener('change', applyPreferences);
systemMotion.addEventListener('change', applyPreferences);
