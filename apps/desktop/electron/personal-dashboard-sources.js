import {CalendarService, CalDavProvider} from '@personal-agent/calendar';
import {MailService, QQMailProvider, decodeMailCursor} from '@personal-agent/mail';

const disconnected = async () => ({connected: false});

/** Production readers. Calendar and mail call the published services only after the
 * existing authorization snapshot says the session may read. Unmerged briefing, budget
 * and activity features stay behind these adapters and are not imported. */
export function createDesktopDashboardSources({
  calendarConfig,
  meetingSnapshot = () => undefined,
  mailConfig,
  createCalendarProvider = options => new CalDavProvider(options),
  createMailProvider = options => new QQMailProvider(options),
  spendLedger = {isAuthorized: () => false, async list() { return []; }},
  budgetCap = {read: disconnected},
  activity = {read: disconnected},
  dailyBriefing = {read: disconnected},
  now = Date.now,
} = {}) {
  return {
    readTime: (window, signal) => readTime({
      isAuthorized: () => calendarAuthorized(calendarConfig, meetingSnapshot),
      createService: () => createCalendarService(calendarConfig, createCalendarProvider, now),
      activity,
    }, window, signal),
    readMail: (window, signal) => readMail({
      isAuthorized: () => mailAuthorized(mailConfig),
      createService: () => createMailService(mailConfig, createMailProvider, now),
      includeSent: true,
    }, window, signal),
    readSpend: (window, signal) => readSpend({ledger: spendLedger, budgetCap}, window, signal),
    readBriefing: (window, signal) => dailyBriefing.read(window, signal),
  };
}

export async function readTime(port, window, signal) {
  const activity = port.activity ? await port.activity.read(window, signal) : {connected: false};
  let calendar = {connected: false, samples: []};
  if (port.isAuthorized?.()) calendar = await readCalendarSamples(port, window, signal);
  if (!calendar.connected && activity?.connected !== true) return {connected: false};
  return {connected: true, samples: [...(calendar.connected ? calendar.samples : []), ...(activity?.connected ? activity.samples : [])]};
}

export async function readCalendarSamples(port, window, signal) {
  const {service, accountRef} = port.createService();
  const deadline = new Date(Date.now() + 30_000).toISOString();
  const samples = [];
  let cursor;
  for (let page = 0; page < 20; page += 1) {
    const result = await service.listEvents(accountRef, window, {limit: 100, signal, deadline, ...(cursor ? {cursor} : {})});
    for (const item of result.items) {
      const [startUtc, endUtc] = String(item.validFor ?? '').split('/');
      if (!startUtc || !endUtc) continue;
      const prefix = String(item.contentRef ?? '');
      const status = prefix.startsWith('[cancelled]') ? 'cancelled' : prefix.startsWith('[tentative]') ? 'tentative' : 'confirmed';
      samples.push({startUtc, endUtc, status});
    }
    if (!result.hasMore || !result.nextCursor) break;
    cursor = result.nextCursor;
  }
  return {connected: true, samples};
}

export async function readMail(port, window, signal) {
  if (!port.isAuthorized?.()) return {connected: false};
  const created = port.createService();
  const samples = [];
  let truncated = false;
  const inbox = await readMailFolder(created, 'INBOX', 'in', window, signal);
  samples.push(...inbox.samples);
  truncated = inbox.truncated;
  let coverage = 'inbound';
  if (port.includeSent) {
    try {
      const sent = await readMailFolder(created, 'Sent Messages', 'out', window, signal);
      samples.push(...sent.samples);
      truncated = truncated || sent.truncated;
      coverage = 'both';
    } catch { /* Sent folder names differ; inbound remains the authorized read. */ }
  }
  return {connected: true, samples, coverage, truncated};
}

async function readMailFolder(created, folder, direction, window, signal) {
  const samples = [];
  let cursor;
  let truncated = false;
  const from = Date.parse(window.fromUtc);
  const to = Date.parse(window.toUtc);
  for (let page = 0; page < 20; page += 1) {
    const result = await created.service.fetchInbox(created.accountRef, {
      folder, limit: 100, signal, ...(cursor ? {cursor: decodeMailCursor(cursor)} : {}),
    });
    for (const item of result.items) {
      const at = Date.parse(item.occurredAt);
      if (at >= from && at < to) samples.push({occurredAt: item.occurredAt, direction});
    }
    if (!result.hasMore || !result.nextCursor) return {samples, truncated};
    cursor = result.nextCursor;
  }
  truncated = true;
  return {samples, truncated};
}

export async function readSpend(port, window, signal) {
  const budget = port.budgetCap ? await port.budgetCap.read(window, signal) : {connected: false};
  if (port.ledger?.isAuthorized?.()) {
    const entries = await port.ledger.list(window, signal);
    if (!Array.isArray(entries)) return {connected: false};
    return {connected: true, samples: entries};
  }
  if (budget?.connected === true && Array.isArray(budget.samples)) return {connected: true, samples: budget.samples};
  return {connected: false};
}

function calendarAuthorized(config, meetingSnapshot) {
  const binding = config?.binding?.();
  const meeting = meetingSnapshot?.() ?? config?.snapshot?.();
  return Boolean(binding && meeting?.sessionAllowed === true);
}

function createCalendarService(config, createProvider, now) {
  const binding = config.binding();
  const authorization = config.readAuthorization(binding);
  const provider = createProvider({
    calendarUrl: binding.calendarUrl,
    authorization,
    allowLoopbackHttp: true,
    ...(binding.calendarName ? {calendarName: binding.calendarName} : {}),
  });
  return {service: new CalendarService(provider, {now}), accountRef: binding.accountRef};
}

function mailAuthorized(config) {
  const saved = config?.current?.();
  return Boolean(saved && config.isSessionAllowed?.(saved.revision));
}

function createMailService(config, createProvider, now) {
  const saved = config.current();
  const provider = createProvider({user: saved.user, authCode: saved.authCode});
  return {service: new MailService(provider, {now}), accountRef: saved.user};
}
