import {createHash} from 'node:crypto';

export interface AuditEvent {
  seq: number;
  at: string;
  action: string;
  subject: string;
  prev: string;
  hash: string;
}

const GENESIS = '0'.repeat(64);
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

export function auditHash(prev: string, event: Pick<AuditEvent, 'seq' | 'at' | 'action' | 'subject'>): string {
  return createHash('sha256').update(`${prev}\n${event.seq}\n${event.at}\n${event.action}\n${event.subject}`).digest('hex');
}

function validEvent(event: AuditEvent, seq: number, prev: string): boolean {
  return !!event && event.seq === seq && event.prev === prev && ISO.test(event.at)
    && typeof event.action === 'string' && event.action.length > 0 && event.action.length <= 64
    && typeof event.subject === 'string' && event.subject.length > 0 && event.subject.length <= 180
    && event.hash === auditHash(prev, event);
}

/** Walk from the genesis hash. A changed earlier row stays visible after later rows are appended. */
export function verifyAudit(events: readonly AuditEvent[]): {intact: boolean; brokenAt: number} {
  let prev = GENESIS;
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];
    if (!event || !validEvent(event, index + 1, prev)) return {intact: false, brokenAt: index + 1};
    prev = event.hash;
  }
  return {intact: true, brokenAt: 0};
}

export function appendAudit(events: readonly AuditEvent[], input: {at: string; action: string; subject: string}): AuditEvent[] {
  const checked = verifyAudit(events);
  if (!checked.intact) throw new Error('审计链已损坏，拒绝在损坏的记录后追加');
  if (!ISO.test(input.at) || !input.action.trim() || input.action.length > 64 || !input.subject.trim() || input.subject.length > 180) {
    throw new Error('审计记录无效');
  }
  const prev = events.at(-1)?.hash ?? GENESIS;
  const seq = events.length + 1;
  const body = {seq, at: input.at, action: input.action, subject: input.subject};
  return [...events, {...body, prev, hash: auditHash(prev, body)}];
}
