import {createWorkspaceReadTool, WORKSPACE_READ_TOOL_NAME, WORKSPACE_READ_TOOL_VERSION} from '@personal-agent/coding-tools';
import {lstatSync, realpathSync} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {SYNTHETIC_REPAIR_EXPORT_POLICY} from './competition-repair-context.js';

export const SYNTHETIC_MEETING_PATH = 'meeting-update.json';
const MAX_BYTES = 2048;
const approvedKeys = ['meetingId', 'revision', 'start', 'timezone'];
const approved = Object.freeze({meetingId: 'mvp-meeting', revision: 2, start: '17:00', timezone: 'Asia/Shanghai'});
const fixtureRoot = fileURLToPath(new URL('../../../tests/manual/agentarts/fixtures/mvp-meeting/', import.meta.url));
const native = value => path.normalize(value).toLowerCase();

function requireSyntheticFixtureRoot(rootPath) {
  const deny = () => { throw Error('Synthetic fixture root unavailable'); };
  if (typeof rootPath !== 'string' || native(path.resolve(rootPath)) !== native(path.resolve(fixtureRoot))) return deny();
  try {
    // Reject junctions/reparse points before the generic workspace tool canonically
    // follows them. Only the dedicated checked-in fixture may become a tool root.
    for (let current = fixtureRoot, end = path.resolve(fixtureRoot, '../../../..');;
      current = path.dirname(current)) {
      if (lstatSync(current).isSymbolicLink()) return deny();
      if (native(current) === native(end)) break;
    }
    if (native(realpathSync.native(fixtureRoot)) !== native(path.resolve(fixtureRoot))
      || lstatSync(path.join(fixtureRoot, SYNTHETIC_MEETING_PATH)).isSymbolicLink()) return deny();
  } catch { return deny(); }
  return fixtureRoot;
}

function exactDataObject(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return false;
  const ownKeys = Reflect.ownKeys(value);
  return ownKeys.length === keys.length && keys.every(key => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor?.enumerable && Object.hasOwn(descriptor, 'value');
  });
}

/** An explicit synthetic-only export gate, never execution authority. */
export function projectSyntheticMeetingResult(result) {
  const deny = () => { throw Error('Synthetic meeting result export denied'); };
  const fields = ['path', 'encoding', 'byteLength', 'content'];
  const hasDigest = result !== null && typeof result === 'object' && Object.hasOwn(result, 'sha256');
  if (hasDigest) fields.push('sha256');
  if (!exactDataObject(result, fields)
    || result.path !== SYNTHETIC_MEETING_PATH || result.encoding !== 'utf-8'
    || typeof result.content !== 'string' || !Number.isSafeInteger(result.byteLength)
    || result.byteLength < 1 || result.byteLength > MAX_BYTES
    || Buffer.byteLength(result.content, 'utf8') !== result.byteLength) return deny();
  // The production read tool includes this optional field. Verify it locally;
  // the public meeting projection still exports only the approved four fields.
  if (hasDigest && (typeof result.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(result.sha256)
    || createHash('sha256').update(result.content, 'utf8').digest('hex') !== result.sha256)) return deny();
  let parsed;
  try { parsed = JSON.parse(result.content); } catch { return deny(); }
  if (!exactDataObject(parsed, approvedKeys)
    || approvedKeys.some(key => parsed[key] !== approved[key])) return deny();
  // Derived from the confirmed tool result, not a fallback if the read failed.
  // Never include the raw file, local path, credentials or an Evidence claim.
  return {meetingId: parsed.meetingId, revision: parsed.revision, start: parsed.start, timezone: parsed.timezone};
}

/** Called only by trusted Competition composition with the dedicated fixture root. */
export function createSyntheticMeetingToolset(rootPath, projectConfirmed = undefined) {
  const tool = createWorkspaceReadTool({rootPath: requireSyntheticFixtureRoot(rootPath), maxReadBytes: MAX_BYTES});
  return {
    tools: [tool],
    competitionToolExports: [{
      toolName: WORKSPACE_READ_TOOL_NAME,
      toolVersion: WORKSPACE_READ_TOOL_VERSION,
      exportPolicyVersion: projectConfirmed ? SYNTHETIC_REPAIR_EXPORT_POLICY : 'synthetic-meeting-v1',
      accepts: ({arguments: args}) => {
        const bounded = exactDataObject(args, ['path', 'maxBytes']);
        if (!bounded && !exactDataObject(args, ['path'])) return false;
        return args.path === SYNTHETIC_MEETING_PATH
          && (!bounded || (Number.isSafeInteger(args.maxBytes) && args.maxBytes >= 1 && args.maxBytes <= MAX_BYTES));
      },
      project: ({taskId, proposalId, result, signal}) => {
        if (signal.aborted) throw Error('Synthetic meeting result export cancelled');
        const meeting = projectSyntheticMeetingResult(result);
        return projectConfirmed ? projectConfirmed({taskId, proposalId, result, meeting, signal}) : meeting;
      },
    }],
  };
}
