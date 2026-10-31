import {createRequire} from 'node:module';
import {dirname, join} from 'node:path';
import {createCanvas} from '@napi-rs/canvas';
import {KnowledgeError} from '../index.js';
import {bounded, checkDocumentContext, DOCUMENT_LIMITS} from './common.js';
import type {DocumentOcr, DocumentUnits} from './common.js';

const require = createRequire(import.meta.url);

export async function parsePdf(bytes: Uint8Array, target: DocumentUnits, ocr: DocumentOcr): Promise<void> {
  const {getDocument, OPS, VerbosityLevel} = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const packageRoot = dirname(require.resolve('pdfjs-dist/package.json'));
  const resource = (name: string) => join(packageRoot, name).replaceAll('\\', '/') + '/';
  const loading = getDocument({data: Uint8Array.from(bytes), useSystemFonts: false, enableXfa: false,
    stopAtErrors: true, useWorkerFetch: false, verbosity: VerbosityLevel.ERRORS,
    maxImageSize: DOCUMENT_LIMITS.pixels, canvasMaxAreaInBytes: DOCUMENT_LIMITS.pixels * 4,
    cMapUrl: resource('cmaps'), cMapPacked: true,
    standardFontDataUrl: resource('standard_fonts'), wasmUrl: resource('wasm'),
  });
  const cancel = () => {void loading.destroy();};
  try {
    const document = await bounded(loading.promise, target.context, cancel);
    if (document.numPages > DOCUMENT_LIMITS.pages) throw new KnowledgeError('LIMIT_EXCEEDED');
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
      checkDocumentContext(target.context);
      const page = await bounded(document.getPage(pageNumber), target.context, cancel);
      try {
        const data = await bounded(page.getTextContent(), target.context, cancel);
        const text = data.items.map(item => 'str' in item ? item.str + (item.hasEOL ? '\n' : ' ') : '').join('').trim();
        target.add('text', `page:${pageNumber};text`, text);
        const operators = await bounded(page.getOperatorList(), target.context, cancel);
        const hasImage = operators.fnArray.some(op => [OPS.paintImageXObject, OPS.paintInlineImageXObject,
          OPS.paintImageMaskXObject].includes(op));
        const hasDrawing = operators.fnArray.includes(OPS.constructPath);
        if (hasDrawing) target.add('image', `page:${pageNumber};drawing`, '',
          {issue: 'VISUAL_REVIEW_REQUIRED: vector illustrations or diagrams are not interpreted as facts'});
        if (hasImage || (!text && hasDrawing)) {
          const viewport = page.getViewport({scale: 2});
          if (viewport.width * viewport.height > DOCUMENT_LIMITS.pixels) {
            target.add('image', `page:${pageNumber};image`, '', {issue: 'PAGE_RENDER_LIMIT: page exceeds the OCR pixel budget'});
            continue;
          }
          const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
          try {
            const render = page.render({canvas: canvas as unknown as HTMLCanvasElement,
              canvasContext: canvas.getContext('2d') as unknown as CanvasRenderingContext2D, viewport});
            await bounded(render.promise, target.context, () => {render.cancel(); cancel();});
            const result = await ocr.recognize(new Uint8Array(canvas.toBuffer('image/png')), target.context);
            target.add('image', `page:${pageNumber};ocr`, result.text, {confidence: result.confidence,
              ...(!result.text.trim() || result.confidence < 0.75 ? {issue: 'OCR_REVIEW_REQUIRED: page text is empty or uncertain'} : {})});
          } catch (error) {
            if (error instanceof KnowledgeError) throw error;
            target.add('image', `page:${pageNumber};ocr`, '', {issue: 'OCR_UNAVAILABLE: page image was not read'});
          } finally {canvas.width = 1; canvas.height = 1;}
        }
      } finally {page.cleanup();}
    }
  } finally {await loading.destroy();}
}
