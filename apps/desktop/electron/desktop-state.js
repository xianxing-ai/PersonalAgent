import {mkdirSync, readFileSync, writeFileSync, renameSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import path from 'node:path';

const HOST_USER_NAMESPACE = /^desktop-user-v1:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export const defaults = {theme: 'system', language: 'system', fontScale: 1, calm: false, alwaysOnTop: true, snap: true, hover: true, shortcut: false, shadowPreview: false};
export function normalizeSettings(value = {}) {
  const result = {...defaults};
  for (const key of ['calm', 'alwaysOnTop', 'snap', 'hover', 'shortcut', 'shadowPreview']) if (typeof value[key] === 'boolean') result[key] = value[key];
  if (['system', 'light', 'dark'].includes(value.theme)) result.theme = value.theme;
  if (['system', 'zh-CN', 'en'].includes(value.language)) result.language = value.language;
  if ([0.9, 1, 1.1, 1.2, 1.3].includes(value.fontScale)) result.fontScale = value.fontScale;
  return result;
}
export function fitBounds(bounds, area) {
  const width = Math.min(Math.max(1, Math.round(bounds.width)), area.width);
  const height = Math.min(Math.max(1, Math.round(bounds.height)), area.height);
  return {width, height, x: Math.round(Math.max(area.x, Math.min(bounds.x, area.x + area.width - width))), y: Math.round(Math.max(area.y, Math.min(bounds.y, area.y + area.height - height)))};
}
export function snapBounds(bounds, area, distance = 24) {
  const fitted = fitBounds(bounds, area);
  for (const [axis, size] of [['x', 'width'], ['y', 'height']]) {
    const end = area[axis] + area[size] - fitted[size];
    if (Math.abs(fitted[axis] - area[axis]) <= distance) fitted[axis] = area[axis];
    else if (Math.abs(fitted[axis] - end) <= distance) fitted[axis] = end;
  }
  return fitted;
}
export class DesktopState {
  constructor(file) {
    this.file = file;
    this.value = {settings: {...defaults}, windows: {}};
    this.identityUnavailable = false;
    try {
      const saved = JSON.parse(readFileSync(file, 'utf8'));
      if (!saved || typeof saved !== 'object' || Array.isArray(saved)) throw Error('Invalid desktop state');
      this.value.settings = normalizeSettings(saved.settings);
      if (Object.hasOwn(saved, 'hostUserNamespace')) {
        if (typeof saved.hostUserNamespace !== 'string' || !HOST_USER_NAMESPACE.test(saved.hostUserNamespace)) {
          this.identityUnavailable = true;
        } else this.value.hostUserNamespace = saved.hostUserNamespace;
      }
      for (const [key, bounds] of Object.entries(saved.windows ?? {})) {
        if (['orb', 'admin', 'workspace', 'desktop-settings'].includes(key) && bounds && ['x', 'y', 'width', 'height'].every(field => Number.isFinite(bounds[field])) && bounds.width > 0 && bounds.height > 0) this.value.windows[key] = bounds;
      }
    } catch (error) {
      // Missing preferences are a first run. A damaged existing file may hold an
      // established Goal identity, so never replace it with a new namespace.
      if (error?.code !== 'ENOENT') this.identityUnavailable = true;
    }
  }
  save(value = this.value) {
    if (this.identityUnavailable) throw Error('Desktop identity settings need recovery before saving');
    mkdirSync(path.dirname(this.file), {recursive: true});
    writeFileSync(this.file + '.tmp', JSON.stringify(value), 'utf8');
    renameSync(this.file + '.tmp', this.file);
  }
  ensureHostUserNamespace() {
    if (this.identityUnavailable) throw Error('Desktop user namespace needs recovery');
    if (this.value.hostUserNamespace) return this.value.hostUserNamespace;
    const namespace = `desktop-user-v1:${randomUUID()}`;
    const next = {...this.value, hostUserNamespace: namespace};
    this.save(next);
    this.value = next;
    return namespace;
  }
  update(patch) {
    if (this.identityUnavailable) throw Error('Desktop identity settings need recovery before saving');
    const next = {...this.value, settings: normalizeSettings({...this.value.settings, ...patch})};
    this.save(next);
    this.value = next;
    return {...next.settings};
  }
  remember(key, bounds) {
    if (this.identityUnavailable) throw Error('Desktop identity settings need recovery before saving');
    const next = {...this.value, windows: {...this.value.windows, [key]: bounds}};
    this.save(next);
    this.value = next;
  }
}
