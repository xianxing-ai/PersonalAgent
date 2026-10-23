const systemTheme = matchMedia('(prefers-color-scheme: dark)');
const systemMotion = matchMedia('(prefers-reduced-motion: reduce)');

export function themePreference() {
  const saved = localStorage.getItem('pa-theme');
  return saved === 'system' ? 'system' : saved === 'light' ? 'light' : 'dark';
}

export function applyPreferences() {
  const preference = themePreference();
  document.documentElement.dataset.theme = preference === 'system' ? (systemTheme.matches ? 'dark' : 'light') : preference;
  document.documentElement.dataset.calm = String(systemMotion.matches || localStorage.getItem('pa-calm') === 'true');
  window.dispatchEvent(new Event('preferences-changed'));
}

export function saveTheme(value) {
  if (!['system', 'dark', 'light'].includes(value)) return;
  localStorage.setItem('pa-theme', value);
  applyPreferences();
}

export function saveCalm(value) {
  localStorage.setItem('pa-calm', String(Boolean(value)));
  applyPreferences();
}

window.addEventListener('storage', event => {
  if (!event.key || ['pa-theme', 'pa-calm'].includes(event.key)) applyPreferences();
});
systemTheme.addEventListener('change', applyPreferences);
systemMotion.addEventListener('change', applyPreferences);
