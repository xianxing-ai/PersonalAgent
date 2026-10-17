import {ProtocolError, validateContract} from '@personal-agent/contracts';
import type {ProtocolContracts} from '@personal-agent/contracts';
import {TaskRuntime} from '../index.js';
import type {ToolExecutionRecord} from '../index.js';

type Evidence = ProtocolContracts['evidence'];

const MAX_PAGE_SIZE = 50;

export interface EvidenceReadScope {
  /** Assigned by the trusted host from its authenticated session, never by a model or renderer. */
  subjectRef: string;
  conversationId: string;
  taskId: string;
}

export interface EvidenceReaderOptions extends EvidenceReadScope {
  runtime: TaskRuntime;
  /** Must check the current session's permission for this exact subject and task on every read. */
  authorize: (scope: Readonly<EvidenceReadScope>) => boolean | Promise<boolean>;
}

export interface EvidencePage {
  items: Evidence[];
  nextBeforeEvidenceId?: string;
}

function requiredId(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 256 || value.trim() !== value) {
    throw new ProtocolError('INVALID_ARGUMENT', `${name} must be a bounded, non-empty identifier`);
  }
  return value;
}

function project(record: ToolExecutionRecord): Evidence {
  const state = record.state;
  if (!['started', 'confirmed', 'failed', 'unknown'].includes(state)) {
    throw new ProtocolError('EXTERNAL_FAILURE', 'Stored evidence state is invalid');
  }
  const evidence: Evidence = {
    evidenceId: record.evidenceId,
    kind: 'execution',
    sourceRef: 'runtime:tool-execution',
    capturedAt: record.finishedAt ?? record.startedAt,
    summary: `Tool execution ${state}`,
    verification: 'conditional',
    sensitivity: 'internal'
  };
  validateContract('evidence', evidence);
  return evidence;
}

/** Host-only metadata view. It never reads tool-result checkpoints or returns tool input/output. */
export class ScopedEvidenceReader {
  private readonly scope: Readonly<EvidenceReadScope>;
  private readonly runtime: TaskRuntime;
  private readonly authorize: EvidenceReaderOptions['authorize'];

  constructor(options: EvidenceReaderOptions) {
    if (!(options.runtime instanceof TaskRuntime) || typeof options.authorize !== 'function') {
      throw new ProtocolError('INVALID_ARGUMENT', 'Evidence reader requires a Runtime and host authorization');
    }
    this.scope = Object.freeze({
      subjectRef: requiredId(options.subjectRef, 'subjectRef'),
      conversationId: requiredId(options.conversationId, 'conversationId'),
      taskId: requiredId(options.taskId, 'taskId')
    });
    this.runtime = options.runtime;
    this.authorize = options.authorize;
  }

  private async entries(): Promise<Evidence[]> {
    let allowed = false;
    try {
      allowed = await this.authorize(this.scope) === true;
    } catch {
      // Do not expose host authorization internals or task existence to the caller.
    }
    if (!allowed) throw new ProtocolError('UNAUTHORIZED', 'Evidence access denied');
    let executions: ToolExecutionRecord[];
    let readback: Evidence[];
    try {
      const task = this.runtime.getTask(this.scope.taskId);
      if (task.conversationId !== this.scope.conversationId) {
        throw new ProtocolError('UNAUTHORIZED', 'Evidence access denied');
      }
      executions = this.runtime.readToolExecutions(this.scope.taskId);
      // Trusted read-back evidence (e.g. platform observation) is read-only
      // host metadata: ids go out, tool input/output checkpoints never do.
      const seen = new Set(executions.map(record => record.evidenceId));
      readback = this.runtime.readEvidence(this.scope.taskId)
        .filter(item => !seen.has(item.evidenceId));
    } catch (error) {
      if (error instanceof ProtocolError && error.code === 'UNAUTHORIZED') throw error;
      throw new ProtocolError('UNAUTHORIZED', 'Evidence access denied');
    }
    // Newest-first executions keep the existing cursor arithmetic; trusted
    // read-back evidence is appended after them without duplicating any id.
    return [...executions.map(project).reverse(), ...readback];
  }

  async list(input: {limit?: number; beforeEvidenceId?: string} = {}): Promise<EvidencePage> {
    const limit = input.limit ?? 20;
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PAGE_SIZE) {
      throw new ProtocolError('INVALID_ARGUMENT', `Evidence limit must be 1..${MAX_PAGE_SIZE}`);
    }
    const before = input.beforeEvidenceId === undefined ? undefined : requiredId(input.beforeEvidenceId, 'beforeEvidenceId');
    const records = await this.entries();
    const start = before === undefined ? 0 : records.findIndex(record => record.evidenceId === before) + 1;
    if (start === 0 && before !== undefined) throw new ProtocolError('NOT_FOUND', 'Evidence cursor not found');
    const page = records.slice(start, start + limit);
    return {
      items: page,
      ...(start + limit < records.length && page.length > 0
        ? {nextBeforeEvidenceId: page.at(-1)!.evidenceId}
        : {})
    };
  }

  async get(evidenceId: string): Promise<Evidence> {
    const id = requiredId(evidenceId, 'evidenceId');
    const record = (await this.entries()).find(item => item.evidenceId === id);
    if (!record) throw new ProtocolError('NOT_FOUND', 'Evidence not found');
    return record;
  }
}
