import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {KnowledgeError} from '../index.js';
import {bounded, checkDocumentContext, DOCUMENT_LIMITS} from './common.js';
import type {DocumentOcr, DocumentReadContext} from './common.js';
import type {Worker} from 'tesseract.js';

/** Inspect dimensions before native decoding to bound image allocation. */
export function imageDimensions(bytes: Uint8Array): {width: number; height: number} {
  const data = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let width = 0, height = 0;
  if (data.length >= 24 && data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    width = data.readUInt32BE(16); height = data.readUInt32BE(20);
  } else if (data.length >= 4 && data[0] === 0xff && data[1] === 0xd8) {
    let offset = 2;
    while (offset + 3 < data.length) {
      if (data[offset++] !== 0xff) throw new Error('INVALID_IMAGE');
      while (data[offset] === 0xff) offset++;
      const marker = data[offset++];
      if (marker === 0xd9 || marker === 0xda) break;
      if (marker === 0x01 || (marker! >= 0xd0 && marker! <= 0xd7)) continue;
      if (offset + 2 > data.length) break;
      const length = data.readUInt16BE(offset);
      if (length < 2 || offset + length > data.length) throw new Error('INVALID_IMAGE');
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker!)) {
        if (length < 8) throw new Error('INVALID_IMAGE');
        height = data.readUInt16BE(offset + 3); width = data.readUInt16BE(offset + 5); break;
      }
      offset += length;
    }
  }
  if (!width || !height) throw new Error('INVALID_IMAGE');
  if (width * height > DOCUMENT_LIMITS.pixels || width > 32_000 || height > 32_000) throw new KnowledgeError('LIMIT_EXCEEDED');
  return {width, height};
}

/** Uses only pinned npm language resources; no CDN, cache files or user paths. */
export function createBundledDocumentOcr(): DocumentOcr {
  let current: Worker | undefined;
  let loading: Promise<Worker> | undefined;
  let disposed = false;
  let chineseFirst = false;
  async function worker(context: DocumentReadContext): Promise<Worker> {
    checkDocumentContext(context);
    if (disposed) throw new KnowledgeError('CANCELLED');
    if (!loading) loading = (async () => {
      const langPath = fileURLToPath(new URL('./ocr-data/', import.meta.url));
      // Preflight both packaged assets; never allow Tesseract's default CDN fallback.
      await Promise.all(['eng', 'chi_sim'].map(async code => {
        const bytes = await readFile(join(langPath, `${code}.traineddata.gz`));
        if (bytes.length < 2 || bytes[0] !== 31 || bytes[1] !== 139) throw new Error('OCR_RESOURCE_UNAVAILABLE');
      }));
      checkDocumentContext(context);
      const {createWorker, OEM} = await import('tesseract.js');
      const created = await createWorker('eng+chi_sim', OEM.LSTM_ONLY, {
        langPath, cacheMethod: 'none', gzip: true, logger: () => {}, errorHandler: () => {},
      });
      if (disposed || context.signal.aborted || Date.now() >= Date.parse(context.deadline)) {
        await created.terminate(); throw new KnowledgeError('CANCELLED');
      }
      current = created;
      return created;
    })();
    return bounded(loading, context, () => {disposed = true; void current?.terminate();});
  }
  return {
    async recognize(bytes, context) {
      checkDocumentContext(context); imageDimensions(bytes);
      const active = await worker(context);
      const cancel = () => {disposed = true; void active.terminate();};
      if (chineseFirst) {
        await bounded(active.reinitialize('eng+chi_sim'), context, cancel);
        chineseFirst = false;
      }
      let result = await bounded(active.recognize(Buffer.from(bytes), {}, {text: true}), context,
        () => {disposed = true; void active.terminate();});
      // English-first avoids CJK substitutions in Latin text. If Han text is detected,
      // let the same bundled engine prioritize Chinese for that page and preserve its confidence.
      if (/\p{Script=Han}/u.test(result.data.text)) {
        await bounded(active.reinitialize('chi_sim+eng'), context, cancel);
        chineseFirst = true;
        result = await bounded(active.recognize(Buffer.from(bytes), {}, {text: true}), context, cancel);
      }
      return {text: result.data.text, confidence: Math.max(0, Math.min(1, result.data.confidence / 100))};
    },
    async dispose() {disposed = true; await current?.terminate();},
  };
}
