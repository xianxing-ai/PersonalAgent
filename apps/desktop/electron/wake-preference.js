import {existsSync, mkdirSync, readFileSync, renameSync, writeFileSync} from 'node:fs';
import path from 'node:path';

export const WAKE_DURATIONS = ['minutes30', 'hours2', 'untilQuit'];
const LEASE_MS = {minutes30: 30 * 60_000, hours2: 2 * 60 * 60_000, untilQuit: 8 * 60 * 60_000};

export function normalizeWakePreference(value) {
  const duration = WAKE_DURATIONS.includes(value?.duration) ? value.duration : 'untilQuit';
  return {enabled: value?.enabled === true, duration};
}

export function wakeLeaseMs(preference) {
  return LEASE_MS[normalizeWakePreference(preference).duration];
}

export function readWakePreference(file) {
  if (!file || !existsSync(file)) return normalizeWakePreference({});
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return normalizeWakePreference({});
    return normalizeWakePreference(parsed);
  } catch {
    return normalizeWakePreference({});
  }
}

export function writeWakePreference(file, preference) {
  const next = normalizeWakePreference(preference);
  mkdirSync(path.dirname(file), {recursive: true});
  const temporary = `${file}.tmp-${process.pid}`;
  writeFileSync(temporary, JSON.stringify({version: 1, ...next}), {encoding: 'utf8', flag: 'wx'});
  renameSync(temporary, file);
  return next;
}
