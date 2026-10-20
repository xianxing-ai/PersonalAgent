import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createCalendarConfig} from '../electron/calendar-config.js';

const input = {providerKind: 'caldav', calendarUrl: 'https://calendar.example.test/private-collection/',
  calendarName: '工作日历', username: 'synthetic-private-account', password: 'synthetic-password'};
function fixture(t) {
  const userData = mkdtempSync(path.join(os.tmpdir(), 'pa-calendar-config-'));
  t.after(() => rmSync(userData, {recursive: true, force: true}));
  const safeStorage = {isEncryptionAvailable: () => true,
    encryptString: value => Buffer.from(value).reverse(),
    decryptString: value => Buffer.from(value).reverse().toString()}; // Explicit Fake encryption.
  const options = {userData, safeStorage};
  return {options, target: path.join(userData, 'calendar-config.json'),
    config: createCalendarConfig(options)};
}

test('calendar configuration persists through trusted storage without UI secrets or read permission', t => {
  const f = fixture(t);
  assert.equal(f.config.snapshot().status, 'unconfigured');
  assert.equal(f.config.binding(), undefined);
  const value = f.config.configure(input);
  assert.equal(value.calendarName, input.calendarName);
  assert.equal(value.status, 'read_unavailable');
  assert.equal(value.configured, true);
  assert.equal(value.readAvailable, false);
  assert.equal(value.sessionAllowed, false);
  assert.equal(value.calendarWriteVerified, false);
  for (const secret of [input.password, input.username, input.calendarUrl, f.config.binding().accountRef,
    f.config.binding().secretRef]) {
    assert.equal(JSON.stringify(value).includes(secret), false);
    assert.equal(readFileSync(f.target, 'utf8').includes(secret), false);
  }
  const restored = createCalendarConfig(f.options);
  assert.deepEqual(restored.snapshot(), value);
  assert.equal(restored.readAuthorization(restored.binding()),
    `Basic ${Buffer.from(`${input.username}:${input.password}`).toString('base64')}`);
});

test('empty password preserves only the same destination and account; changed bindings cannot resolve secrets', t => {
  const f = fixture(t);
  f.config.configure(input);
  const old = f.config.binding();
  const header = f.config.readAuthorization(old);
  f.config.configure({...input, calendarName: '改名', password: ''});
  const current = f.config.binding();
  assert.equal(current.accountRef, old.accountRef);
  assert.equal(f.config.readAuthorization(current), header);
  assert.throws(() => f.config.readAuthorization(old), /已变更或撤销/);
  assert.throws(() => f.config.readAuthorization({...current, calendarUrl: 'https://other.example.test/'}));
  assert.throws(() => f.config.configure({...input, password: '', calendarUrl: 'https://other.example.test/'}));
  assert.throws(() => f.config.configure({...input, password: '', username: 'another-account'}));
  assert.equal(f.config.readAuthorization(current), header);
  f.config.configure({...input, calendarUrl: 'https://other.example.test/'});
  assert.notEqual(f.config.binding().accountRef, current.accountRef);
  assert.throws(() => f.config.readAuthorization(current));
});

test('invalid destinations, injection and unsupported inputs preserve the previous configuration', t => {
  const f = fixture(t);
  f.config.configure(input);
  const before = readFileSync(f.target, 'utf8');
  for (const change of [
    {providerKind: 'fake'}, {calendarUrl: 'http://calendar.example.test/'},
    {calendarUrl: 'https://user:secret@calendar.example.test/'},
    {calendarUrl: 'https://calendar.example.test/?token=private'},
    {calendarUrl: 'https://calendar.example.test/#private'},
    {calendarUrl: `https://calendar.example.test/${'日'.repeat(300)}/`},
    {username: 'bad:account'}, {username: ''}, {password: 'private\r\nHeader: injected'},
    {password: 7}, {calendarName: '\u0000'}, {readConsent: true}, {accountRef: 'renderer-selected'},
  ]) {
    assert.throws(() => f.config.configure({...input, ...change}));
    assert.equal(readFileSync(f.target, 'utf8'), before);
  }
});

test('loopback HTTP collection pages pass only for localhost, 127.0.0.1 and [::1] and keep https rules elsewhere', t => {
  const f = fixture(t);
  for (const [raw, stored] of [
    ['http://localhost:5233/potatos/mvp', 'http://localhost:5233/potatos/mvp/'],
    ['http://127.0.0.1:5233/potatos/mvp/', 'http://127.0.0.1:5233/potatos/mvp/'],
    ['http://[::1]:5233/potatos/mvp/', 'http://[::1]:5233/potatos/mvp/'],
  ]) {
    f.config.configure({...input, calendarUrl: raw});
    assert.equal(f.config.binding().calendarUrl, stored);
  }
  const snapshot = f.config.snapshot();
  for (const bad of ['http://calendar.example.test/', 'http://192.168.1.10:5233/x/', 'http://calendar.example.test/?q=1']) {
    assert.throws(() => f.config.configure({...input, calendarUrl: bad}), /HTTPS/);
    assert.deepEqual(f.config.snapshot(), snapshot);
  }
});

test('unavailable encryption and corrupt storage fail safely; explicit revoke removes only calendar configuration', t => {
  const f = fixture(t);
  f.config.configure(input);
  const before = readFileSync(f.target, 'utf8');
  f.options.safeStorage.isEncryptionAvailable = () => false;
  assert.throws(() => f.config.configure({...input, password: 'new-private-secret'}),
    error => /未保存/.test(error.message) && !/new-private-secret/.test(error.message));
  assert.equal(readFileSync(f.target, 'utf8'), before);
  assert.equal(createCalendarConfig(f.options).snapshot().status, 'unavailable');
  f.options.safeStorage.isEncryptionAvailable = () => true;
  writeFileSync(f.target, '{invalid');
  const corrupt = createCalendarConfig(f.options);
  assert.equal(corrupt.snapshot().status, 'unavailable');
  assert.equal(corrupt.binding(), undefined);
  assert.equal(readFileSync(f.target, 'utf8'), '{invalid');
  const other = path.join(f.options.userData, 'agentarts-config.json');
  writeFileSync(other, 'synthetic-other-config');
  corrupt.configure(input);
  const binding = corrupt.binding();
  assert.equal(corrupt.revoke().status, 'unconfigured');
  assert.equal(existsSync(f.target), false);
  assert.equal(readFileSync(other, 'utf8'), 'synthetic-other-config');
  assert.throws(() => corrupt.readAuthorization(binding));
});
