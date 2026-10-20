import {release} from 'node:os';

// DWM system backdrops require Windows 11 22H2. Other hosts keep an opaque,
// readable backing rather than exposing sharp desktop text through the panel.
export function supportsPanelAcrylic({platform = process.platform, version = release()} = {}) {
  const [major, , build] = String(version).split('.').map(Number);
  return platform === 'win32' && major >= 10 && build >= 22621;
}

export function panelWindowAppearance(theme, host) {
  const acrylic = supportsPanelAcrylic(host)
    && !theme.prefersReducedTransparency && !theme.shouldUseHighContrastColors;
  return {transparent: false, backgroundMaterial: acrylic ? 'acrylic' : 'none',
    backgroundColor: acrylic ? '#00000000' : theme.shouldUseDarkColors ? '#181d27' : '#f1f5fc'};
}

export function bindPanelMaterial(win, theme, host) {
  let signature;
  const apply = () => {
    if (win.isDestroyed()) return;
    const appearance = panelWindowAppearance(theme, host), next = JSON.stringify(appearance);
    if (signature === next) return;
    signature = next;
    try {
      if (supportsPanelAcrylic(host)) win.setBackgroundMaterial(appearance.backgroundMaterial);
      win.setBackgroundColor(appearance.backgroundColor);
    } catch {
      // Material is optional; compositor/remote-session failures must not break input.
      win.setBackgroundColor(theme.shouldUseDarkColors ? '#181d27' : '#f1f5fc');
    }
  };
  apply();theme.on('updated', apply);
  win.once('closed', () => theme.removeListener('updated', apply));
}
