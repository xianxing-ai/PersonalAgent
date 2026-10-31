export interface WikiImportUnit {
  readonly id: string;
  readonly locator: string;
  readonly text: string;
  readonly kind: 'text' | 'table' | 'image';
  readonly status?: 'processed' | 'empty' | 'needs_attention';
  readonly confidence?: number;
}

export interface WikiImportDocument {
  readonly sourceId: string;
  readonly revision: string;
  readonly name: string;
  readonly format: string;
  readonly units: readonly WikiImportUnit[];
  readonly coverage: {
    readonly total: number;
    readonly processed: number;
    readonly issues: readonly {readonly unitId?: string; readonly reason: string}[];
  };
}

export interface WikiImportContext {
  readonly deadline: string;
  readonly signal: AbortSignal;
  /** Supplied by the trusted host; never inferred from document or model content. */
  readonly assertCurrent: () => void;
}

export interface WikiEvidence {
  readonly sourceId: string;
  readonly revision: string;
  readonly unitId: string;
  readonly quote: string;
}

export interface WikiClaim {
  readonly id: string;
  readonly text: string;
  readonly kind: 'fact' | 'inference' | 'conflict';
  readonly topic: string;
  readonly entities: readonly string[];
  readonly evidence: readonly WikiEvidence[];
}

export interface WikiGeneratedPage {
  readonly id: string;
  readonly path: string;
  readonly title: string;
  readonly kind: 'index' | 'source' | 'topic' | 'entity' | 'timeline' | 'procedure' | 'comparison' | 'synthesis' | 'questions' | 'report';
  readonly markdown: string;
  readonly sourceIds: readonly string[];
  readonly claimIds: readonly string[];
  readonly evidence: readonly WikiEvidence[];
}

export interface WikiModelRequest {
  readonly stage: 'extract' | 'organize' | 'answer';
  readonly requestId: string;
  readonly system: string;
  readonly input: string;
  readonly outputSchema: Readonly<Record<string, unknown>>;
  readonly maxOutputCharacters: number;
}

export interface WikiModelResult {
  readonly output: unknown;
  readonly usage?: {readonly inputTokens?: number; readonly outputTokens?: number};
}

export interface WikiImportModel {
  /** Includes provider/model configuration and workflow version, without credentials. */
  readonly fingerprint: string;
  invoke(request: WikiModelRequest, context: WikiImportContext): Promise<WikiModelResult>;
}

export interface WikiImportBudget {
  readonly maxCalls: number;
  readonly maxInputCharacters: number;
  readonly maxOutputCharacters: number;
}

export interface WikiCompileProgress {
  readonly stage: 'extract' | 'organize' | 'validate';
  readonly completed: number;
  readonly total: number;
  readonly calls: number;
  readonly cacheHits: number;
}

export interface WikiCompileCache {
  get(key: string): unknown | undefined;
  set(key: string, value: unknown): void;
}

export interface WikiCompiledLibrary {
  readonly fingerprint: string;
  readonly modelFingerprint: string;
  readonly sources: readonly WikiImportDocument[];
  readonly claims: readonly WikiClaim[];
  readonly pages: readonly WikiGeneratedPage[];
  readonly coverage: {
    readonly total: number;
    readonly processed: number;
    readonly issues: readonly {readonly sourceId: string; readonly unitId?: string; readonly reason: string}[];
  };
  readonly usage: {
    readonly calls: number;
    readonly cacheHits: number;
    readonly inputCharacters: number;
    readonly outputCharacters: number;
    readonly inputTokens: number;
    readonly outputTokens: number;
  };
}

export type WikiImportErrorCode = 'INVALID_ARGUMENT' | 'INVALID_MODEL_OUTPUT' | 'SOURCE_CHANGED'
  | 'SCOPE_DENIED' | 'CANCELLED' | 'TIMEOUT' | 'BUDGET_EXCEEDED' | 'REVISION_CONFLICT'
  | 'PUBLICATION_PENDING' | 'MANUAL_EDIT_CONFLICT' | 'SOURCE_UNAVAILABLE';

export class WikiImportError extends Error {
  constructor(readonly code: WikiImportErrorCode) {super(code); this.name = 'WikiImportError';}
}
