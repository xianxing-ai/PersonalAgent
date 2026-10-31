import {createHash} from 'node:crypto';
import {extname} from 'node:path';
import {Worker} from 'node:worker_threads';
import {KnowledgeError} from '../index.js';
import type {WikiImportDocument} from '../wiki-import/types.js';
import {DOCUMENT_LIMITS, DocumentUnits, bounded, checkDocumentContext, decodeDocumentText} from './common.js';
import type {DocumentOcr, DocumentReadContext} from './common.js';
import {parseLines, parseCsv, parseHtml} from './text.js';
import {parseOffice} from './office.js';
import {parsePdf} from './pdf.js';
import {createBundledDocumentOcr, imageDimensions} from './ocr.js';

export {DOCUMENT_LIMITS, createBundledDocumentOcr};
export type {DocumentOcr, DocumentReadContext};
export const DOCUMENT_PARSER_VERSION = 'wiki-documents-v1';

export interface ParseWikiDocumentRequest extends DocumentReadContext {
  readonly sourceId: string;
  readonly name: string;
  readonly bytes: Uint8Array;
  /** Trusted-host override, chiefly for explicit test adapters; default is bundled local OCR. */
  readonly ocr?: DocumentOcr;
}

function validateRequest(request: ParseWikiDocumentRequest): void {
  checkDocumentContext(request);
  if (typeof request.sourceId !== 'string' || !/^[A-Za-z0-9_.:-]{1,128}$/.test(request.sourceId)
    || typeof request.name !== 'string' || !request.name || request.name.length > 1024
    || /[:\u0000-\u001f]/.test(request.name) || request.name.split(/[/\\]/).some(part => !part || part === '.' || part === '..')
    || !(request.bytes instanceof Uint8Array)) throw new KnowledgeError('INVALID_ARGUMENT');
  if (request.bytes.length > DOCUMENT_LIMITS.bytes) throw new KnowledgeError('LIMIT_EXCEEDED');
}

/** Production entry: bounded V8 heap plus byte/pixel caps; termination enforces synchronous parser deadlines. */
export async function parseWikiDocumentInWorker(request: Omit<ParseWikiDocumentRequest, 'ocr'>): Promise<WikiImportDocument> {
  validateRequest(request);
  const bytes = Uint8Array.from(request.bytes);
  const worker = new Worker(new URL('./worker.js', import.meta.url), {
    workerData: {sourceId: request.sourceId, name: request.name, bytes, deadline: request.deadline},
    transferList: [bytes.buffer], execArgv: [], stdout: true, stderr: true,
    resourceLimits: {maxOldGenerationSizeMb: 512, stackSizeMb: 8},
  });
  // Third-party parser diagnostics may contain source text. Only typed outcomes leave the worker.
  worker.stdout.resume(); worker.stderr.resume();
  try {
    const outcome = new Promise<WikiImportDocument>((resolve, reject) => {
      worker.once('message', (message: {result?: WikiImportDocument; error?: string}) => {
        if (message?.result) resolve(message.result);
        else {
          const code = ['INVALID_ARGUMENT', 'CANCELLED', 'TIMEOUT', 'LIMIT_EXCEEDED', 'SCOPE_DENIED', 'SOURCE_CHANGED'].includes(message?.error ?? '')
            ? message.error as KnowledgeError['code'] : 'SOURCE_UNAVAILABLE';
          reject(new KnowledgeError(code));
        }
      });
      worker.once('error', error => reject(new KnowledgeError((error as NodeJS.ErrnoException).code === 'ERR_WORKER_OUT_OF_MEMORY'
        ? 'LIMIT_EXCEEDED' : 'SOURCE_UNAVAILABLE')));
      worker.once('exit', () => reject(new KnowledgeError('SOURCE_UNAVAILABLE')));
    });
    return await bounded(outcome, request, () => {void worker.terminate();});
  } finally {await worker.terminate();}
}

/** Byte-only parser. The host owns selection, source identity, authorization and storage. */
export async function parseWikiDocument(request: ParseWikiDocumentRequest): Promise<WikiImportDocument> {
  validateRequest(request);
  const bytes = Uint8Array.from(request.bytes);
  const extension = extname(request.name).toLowerCase().slice(1);
  const format = ({markdown: 'md', htm: 'html', jpeg: 'jpg'} as Record<string, string>)[extension] ?? extension;
  const revision = createHash('sha256').update(bytes).digest('hex');
  const target = new DocumentUnits(request);
  const ocr = request.ocr ?? createBundledDocumentOcr();
  try {
    if (['md', 'txt', 'html', 'csv'].includes(format)) {
      const text = decodeDocumentText(bytes);
      if (format === 'html') parseHtml(text, target, request);
      else if (format === 'csv') parseCsv(text, target);
      else parseLines(text, target);
    } else if (['docx', 'pptx', 'xlsx'].includes(format)) {
      if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) throw new Error('FORMAT_MISMATCH');
      await parseOffice(format as 'docx' | 'pptx' | 'xlsx', bytes, target, ocr);
    } else if (format === 'pdf') {
      if (Buffer.from(bytes.subarray(0, 5)).toString('ascii') !== '%PDF-') throw new Error('FORMAT_MISMATCH');
      await parsePdf(bytes, target, ocr);
    } else if (format === 'png' || format === 'jpg') {
      if (format === 'png' ? bytes[0] !== 137 || bytes[1] !== 80 : bytes[0] !== 0xff || bytes[1] !== 0xd8) {
        throw new Error('FORMAT_MISMATCH');
      }
      imageDimensions(bytes);
      const result = await ocr.recognize(bytes, request);
      target.add('image', 'image:1', result.text, {confidence: result.confidence,
        ...(!result.text.trim() || result.confidence < 0.75 ? {issue: 'OCR_REVIEW_REQUIRED: image text is empty or uncertain'} : {})});
    } else target.add('text', 'document', '', {issue: 'UNSUPPORTED_FORMAT: select a supported document format'});
  } catch (error) {
    if (error instanceof KnowledgeError) throw error;
    // Parser errors may contain private source text, paths or passwords. Persist only fixed diagnoses.
    target.add('text', 'document', '', {issue: 'DOCUMENT_PARSE_FAILED: corrupt, encrypted, mismatched or unreadable document'});
  } finally {if (!request.ocr) await ocr.dispose?.();}
  checkDocumentContext(request);
  return {sourceId: request.sourceId, revision, name: request.name, format, ...target.finish()};
}
