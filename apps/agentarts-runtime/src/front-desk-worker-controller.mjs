import {ProtocolError} from '@personal-agent/contracts';
import {
  classifyToolSurface,
  isToolAllowedOnSurface,
  projectBuiltinWorkers,
  resolveBuiltinWorker,
  DEFAULT_WORKERS,
} from '@personal-agent/agentarts';

const plain = value => value && typeof value === 'object' && !Array.isArray(value);
const exact = (value, keys) => plain(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const bad = message => { throw new ProtocolError('INVALID_ARGUMENT', message); };

/**
 * Owned-image controller: front-desk vs worker surface + read-only worker roster.
 * Does not grant tools; local Policy / ToolGateway still decide authorization.
 */
export function createFrontDeskWorkerController() {
  return async ({value}) => {
    if (!plain(value) || value.frontDeskWorkerVersion !== 1) bad('Invalid front-desk worker protocol');
    const {frontDeskWorkerVersion: _, ...operation} = value;
    if (operation.operation === 'list_workers') {
      if (Object.keys(operation).length !== 1) bad('Invalid list_workers');
      return {
        frontDeskWorkerVersion: 1,
        verification: 'unverified',
        workers: projectBuiltinWorkers(),
        builtins: DEFAULT_WORKERS.map(item => ({
          workerId: item.workerId,
          role: item.role,
          preferredDriver: item.preferredDriver,
        })),
      };
    }
    if (operation.operation === 'classify_surface') {
      if (!exact(operation, ['operation', 'hasAssistantTurn', 'hasSubtaskParent'])) bad('Invalid classify_surface');
      if (typeof operation.hasAssistantTurn !== 'boolean' || typeof operation.hasSubtaskParent !== 'boolean') {
        bad('Invalid classify_surface flags');
      }
      const surface = classifyToolSurface({
        hasAssistantTurn: operation.hasAssistantTurn,
        hasSubtaskParent: operation.hasSubtaskParent,
      });
      return {frontDeskWorkerVersion: 1, verification: 'unverified', surface};
    }
    if (operation.operation === 'assert_tool') {
      if (!exact(operation, ['operation', 'surface', 'toolName'])) bad('Invalid assert_tool');
      if (!['front_desk', 'assistant_chat', 'worker'].includes(operation.surface)
        || typeof operation.toolName !== 'string' || !operation.toolName.trim()) {
        bad('Invalid assert_tool fields');
      }
      return {
        frontDeskWorkerVersion: 1,
        verification: 'unverified',
        allowed: isToolAllowedOnSurface(operation.surface, operation.toolName),
      };
    }
    if (operation.operation === 'resolve_worker') {
      if (!plain(operation) || operation.operation !== 'resolve_worker') bad('Invalid resolve_worker');
      const keys = Object.keys(operation).filter(key => key !== 'operation');
      if (keys.some(key => !['workerId', 'role', 'createIfMissing'].includes(key))) bad('Invalid resolve_worker fields');
      const resolved = resolveBuiltinWorker({
        ...(typeof operation.workerId === 'string' ? {workerId: operation.workerId} : {}),
        ...(typeof operation.role === 'string' ? {role: operation.role} : {}),
        ...(operation.createIfMissing === true ? {createIfMissing: true} : {}),
      });
      return {
        frontDeskWorkerVersion: 1,
        verification: 'unverified',
        action: resolved.action,
        ...(resolved.worker ? {worker: resolved.worker} : {}),
      };
    }
    throw new ProtocolError('UNSUPPORTED_CAPABILITY', 'Unsupported front-desk worker operation');
  };
}
