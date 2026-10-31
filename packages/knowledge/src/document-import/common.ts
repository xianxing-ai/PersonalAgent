import {KnowledgeError} from '../index.js';
import type {WikiImportDocument, WikiImportUnit} from '../wiki-import/types.js';

export interface DocumentReadContext {
  readonly deadline: string;
  readonly signal: AbortSignal;
}

export interface DocumentOcr {
  recognize(bytes: Uint8Array, context: DocumentReadContext): Promise<{text: string; confidence: number}>;
  dispose?(): Promise<void>;
}

export const DOCUMENT_LIMITS = Object.freeze({
  bytes: 64 * 1024 * 1024, expandedBytes: 128 * 1024 * 1024,
  archiveEntries: 10_000, units: 50_000, characters: 8_000_000,
  pages: 1_000, pixels: 16_000_000, xmlDepth: 100,
});

export function checkDocumentContext(context: DocumentReadContext): void {
  if (!context || typeof context.deadline !== 'string' || !Number.isFinite(Date.parse(context.deadline))
    || !context.signal || typeof context.signal.aborted !== 'boolean') throw new KnowledgeError('INVALID_ARGUMENT');
  if (context.signal.aborted) throw new KnowledgeError('CANCELLED');
  if (Date.now() >= Date.parse(context.deadline)) throw new KnowledgeError('TIMEOUT');
}

/** Cancels the underlying parser/worker as well as the wait. Never returns a late result. */
export async function bounded<T>(operation: Promise<T>, context: DocumentReadContext, cancel: () => void): Promise<T> {
  try {checkDocumentContext(context);} catch (error) {
    void operation.catch(() => {});
    try {cancel();} catch { /* Keep the original cancellation reason. */ }
    throw error;
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abort: (() => void) | undefined;
  try {
    const result = await Promise.race([operation, new Promise<never>((_, reject) => {
      const stop = (code: 'CANCELLED' | 'TIMEOUT') => {
        try {cancel();} catch { /* Cancellation must not expose parser internals. */ }
        reject(new KnowledgeError(code));
      };
      abort = () => stop('CANCELLED');
      context.signal.addEventListener('abort', abort, {once: true});
      timer = setTimeout(() => stop('TIMEOUT'), Math.min(2_147_483_647, Date.parse(context.deadline) - Date.now()));
      if (context.signal.aborted) abort();
    })]);
    checkDocumentContext(context);
    return result;
  } finally {
    if (timer) clearTimeout(timer);
    if (abort) context.signal.removeEventListener('abort', abort);
  }
}

export function decodeDocumentText(bytes: Uint8Array): string {
  const encoding = bytes[0] === 0xff && bytes[1] === 0xfe ? 'utf-16le'
    : bytes[0] === 0xfe && bytes[1] === 0xff ? 'utf-16be' : 'utf-8';
  const result = new TextDecoder(encoding, {fatal: true}).decode(bytes);
  if (result.includes('\0')) throw new Error('BINARY_TEXT');
  return result;
}

export class DocumentUnits {
  readonly units: WikiImportUnit[] = [];
  readonly issues: {unitId?: string; reason: string}[] = [];
  private characters = 0;
  constructor(readonly context: DocumentReadContext) {}

  add(kind: WikiImportUnit['kind'], locator: string, text: string, options: {
    confidence?: number; issue?: string;
  } = {}): void {
    checkDocumentContext(this.context);
    if (this.units.length >= DOCUMENT_LIMITS.units || (this.characters += text.length) > DOCUMENT_LIMITS.characters) {
      throw new KnowledgeError('LIMIT_EXCEEDED');
    }
    const id = `unit-${this.units.length + 1}`;
    const status = options.issue ? 'needs_attention' : text.trim() ? 'processed' : 'empty';
    this.units.push({id, kind, locator, text, status,
      ...(options.confidence === undefined ? {} : {confidence: options.confidence})});
    if (options.issue) this.issues.push({unitId: id, reason: options.issue});
  }

  finish(): Pick<WikiImportDocument, 'units' | 'coverage'> {
    if (this.units.length === 0) this.add('text', 'document', '');
    return {units: this.units, coverage: {total: this.units.length,
      processed: this.units.filter(unit => unit.status !== 'needs_attention').length, issues: this.issues}};
  }
}
