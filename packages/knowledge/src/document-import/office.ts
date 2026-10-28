import {posix} from 'node:path';
import {unzipSync} from 'fflate';
import {XMLParser, XMLValidator} from 'fast-xml-parser';
import {KnowledgeError} from '../index.js';
import {DOCUMENT_LIMITS, DocumentUnits, checkDocumentContext, decodeDocumentText} from './common.js';
import type {DocumentOcr} from './common.js';

interface Element {name: string; attributes: Record<string, string>; children: Element[]; text?: string}
const local = (name: string) => name.split(':').at(-1)!;
function xml(bytes: Uint8Array): Element[] {
  const text = decodeDocumentText(bytes);
  if (/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(text) || XMLValidator.validate(text) !== true) throw new Error('INVALID_XML');
  const parser = new XMLParser({preserveOrder: true, ignoreAttributes: false,
    parseTagValue: false, parseAttributeValue: false, trimValues: false});
  function convert(nodes: Record<string, unknown>[], depth: number): Element[] {
    if (depth > DOCUMENT_LIMITS.xmlDepth) throw new KnowledgeError('LIMIT_EXCEEDED');
    return nodes.flatMap(node => Object.entries(node).filter(([key]) => key !== ':@' && !key.startsWith('?')).map(([key, value]) => {
      if (key === '#text' || key === '#cdata') return {name: '#text', attributes: {}, children: [], text: String(value)};
      const attributes = Object.fromEntries(Object.entries((node[':@'] ?? {}) as Record<string, unknown>)
        .map(([name, value]) => [name.replace(/^@_/, ''), String(value)]));
      return {name: local(key), attributes, children: Array.isArray(value) ? convert(value, depth + 1) : []};
    }));
  }
  return convert(parser.parse(text), 0);
}

function find(nodes: Element[], name: string): Element[] {
  return nodes.flatMap(node => node.name === name ? [node] : find(node.children, name));
}
function plain(node: Element): string {
  if (node.name === '#text') return node.text ?? '';
  if (node.name === 'tab') return '\t';
  if (node.name === 'br' || node.name === 'cr') return '\n';
  return node.children.map(plain).join('');
}
function visible(node: Element): string {
  if (['del', 'instrText', 'fldChar'].includes(node.name)) return '';
  if (node.name === 't') return plain(node);
  if (['tab', 'br', 'cr'].includes(node.name)) return plain(node);
  return node.children.map(visible).join('');
}

function archive(bytes: Uint8Array, target: DocumentUnits): Record<string, Uint8Array> {
  let size = 0, count = 0;
  const seen = new Set<string>();
  const files = unzipSync(bytes, {filter: entry => {
    checkDocumentContext(target.context);
    if (!Number.isSafeInteger(entry.originalSize) || entry.originalSize < 0
      || ++count > DOCUMENT_LIMITS.archiveEntries || (size += entry.originalSize) > DOCUMENT_LIMITS.expandedBytes
      || entry.originalSize > DOCUMENT_LIMITS.expandedBytes) throw new KnowledgeError('LIMIT_EXCEEDED');
    if (seen.has(entry.name) || /^[/\\]|\\|(^|\/)\.\.?(\/|$)|:|\0/.test(entry.name)) throw new Error('INVALID_ARCHIVE_PATH');
    seen.add(entry.name);
    return !entry.name.endsWith('/');
  }});
  if (Object.values(files).reduce((sum, data) => sum + data.length, 0) > DOCUMENT_LIMITS.expandedBytes) {
    throw new KnowledgeError('LIMIT_EXCEEDED');
  }
  return files;
}

export async function parseOffice(format: 'docx' | 'pptx' | 'xlsx', bytes: Uint8Array,
  target: DocumentUnits, ocr: DocumentOcr): Promise<void> {
  const files = archive(bytes, target);
  const required = format === 'docx' ? 'word/document.xml' : format === 'pptx' ? 'ppt/presentation.xml' : 'xl/workbook.xml';
  if (!files['[Content_Types].xml'] || !files[required]) throw new Error('FORMAT_MISMATCH');
  if (Object.keys(files).some(name => /vbaProject\.bin$/i.test(name))) throw new Error('MACRO_PACKAGE_UNSUPPORTED');
  const parsed = new Map<string, Element[]>();
  const read = (path: string) => {
    checkDocumentContext(target.context);
    if (!files[path]) throw new Error('MISSING_PACKAGE_PART');
    let result = parsed.get(path);
    if (!result) {result = xml(files[path]!); parsed.set(path, result);}
    return result;
  };
  const rootName = format === 'docx' ? 'document' : format === 'pptx' ? 'presentation' : 'workbook';
  if (!read(required).some(node => node.name === rootName)
    || (format === 'docx' && !find(read(required), 'body').length)) throw new Error('INVALID_OFFICE_ROOT');
  const relationships = (part: string) => {
    const path = posix.join(posix.dirname(part), '_rels', `${posix.basename(part)}.rels`);
    return new Map((files[path] ? find(read(path), 'Relationship') : []).map(item => [item.attributes.Id!, item.attributes]));
  };
  const resolve = (part: string, relationship: Record<string, string> | undefined): string | undefined => {
    if (!relationship || relationship.TargetMode === 'External' || !relationship.Target) return undefined;
    const raw = relationship.Target;
    if (/\\|:|\0/.test(raw)) return undefined;
    const path = raw.startsWith('/') ? raw.slice(1) : posix.normalize(posix.join(posix.dirname(part), raw));
    if (path.startsWith('../') || !files[path]) return undefined;
    return path;
  };
  async function images(part: string, nodes: Element[], prefix: string): Promise<void> {
    const rels = relationships(part);
    let i = 0;
    for (const element of find(nodes, 'blip')) {
      const locator = `${prefix};image:${++i}`;
      const path = resolve(part, rels.get(element.attributes['r:embed'] ?? element.attributes['r:link'] ?? ''));
      if (!path || !/\.(?:png|jpe?g)$/i.test(path)) {
        target.add('image', locator, '', {issue: 'IMAGE_UNAVAILABLE: external or unsupported embedded image'}); continue;
      }
      try {
        const result = await ocr.recognize(files[path]!, target.context);
        target.add('image', locator, result.text, {confidence: result.confidence,
          ...(!result.text.trim() || result.confidence < 0.75 ? {issue: 'OCR_REVIEW_REQUIRED: image text is empty or uncertain'} : {})});
      } catch (error) {
        if (error instanceof KnowledgeError) throw error;
        target.add('image', locator, '', {issue: 'OCR_UNAVAILABLE: embedded image was not read'});
      }
    }
    for (const name of ['chart', 'OLEObject', 'object', 'oMath', 'altChunk']) {
      for (const _ of find(nodes, name)) target.add('image', `${prefix};${name}:${++i}`, '',
        {issue: 'VISUAL_REVIEW_REQUIRED: chart, equation or embedded object not interpreted'});
    }
  }

  if (format === 'docx') {
    const parts = Object.keys(files).filter(name => /^word\/(?:document|header\d+|footer\d+|footnotes|endnotes)\.xml$/.test(name));
    for (const part of parts.sort((a, b) => a === required ? -1 : b === required ? 1 : a.localeCompare(b))) {
      const nodes = read(part);
      const content = part === required ? find(nodes, 'body').flatMap(node => node.children) : nodes;
      let paragraph = 0, table = 0;
      function walk(items: Element[]): void {
        for (const item of items) {
          if (item.name === 'p') target.add('text', `${part};paragraph:${++paragraph}`, visible(item));
          else if (item.name === 'tbl') {
            const rows = find(item.children, 'tr').map(row => find(row.children, 'tc').map(cell =>
              find(cell.children, 'p').map(visible).join('\n')));
            target.add('table', `${part};table:${++table}`, rows.map(row => JSON.stringify(row)).join('\n'));
          } else walk(item.children);
        }
      }
      walk(content);
      await images(part, nodes, part);
    }
  } else if (format === 'pptx') {
    const rels = relationships(required);
    const slides = find(read(required), 'sldId');
    let slide = 0;
    for (const entry of slides) {
      const prefix = `slide:${++slide}`;
      const part = resolve(required, rels.get(entry.attributes['r:id'] ?? ''));
      if (!part) {target.add('text', prefix, '', {issue: 'MISSING_SLIDE'}); continue;}
      const nodes = read(part);
      let paragraph = 0, table = 0;
      function slideContent(items: Element[]): void {
        for (const item of items) {
          if (item.name === 'tbl') {
            const rows = find(item.children, 'tr').map(row => find(row.children, 'tc').map(cell =>
              find(cell.children, 'p').map(visible).join('\n')));
            target.add('table', `${prefix};table:${++table}`, rows.map(row => JSON.stringify(row)).join('\n'));
          } else if (item.name === 'p') target.add('text', `${prefix};paragraph:${++paragraph}`, visible(item));
          else slideContent(item.children);
        }
      }
      slideContent(nodes);
      if (!paragraph) target.add('text', prefix, '');
      await images(part, nodes, prefix);
      for (const relation of relationships(part).values()) {
        if (!relation.Type?.endsWith('/notesSlide')) continue;
        const notes = resolve(part, relation);
        if (!notes) {target.add('text', `${prefix};notes`, '', {issue: 'MISSING_SLIDE_NOTES'}); continue;}
        for (const p of find(read(notes), 'p')) target.add('text', `${prefix};notes-paragraph:${++paragraph}`, visible(p));
      }
    }
  } else {
    const shared = files['xl/sharedStrings.xml'] ? find(read('xl/sharedStrings.xml'), 'si').map(visible) : [];
    const rels = relationships(required);
    for (const sheet of find(read(required), 'sheet')) {
      const name = sheet.attributes.name ?? 'Sheet';
      const part = resolve(required, rels.get(sheet.attributes['r:id'] ?? ''));
      if (!part) {target.add('table', `sheet:${name}`, '', {issue: 'MISSING_WORKSHEET'}); continue;}
      const nodes = read(part);
      let count = 0;
      for (const row of find(nodes, 'row')) {
        const values: string[] = [];
        for (const cell of find(row.children, 'c')) {
          const address = cell.attributes.r ?? `column-${values.length + 1}`;
          const v = find(cell.children, 'v')[0];
          const formula = find(cell.children, 'f')[0];
          let value = v ? plain(v) : '';
          if (cell.attributes.t === 's') {
            const index = Number(value);
            if (!Number.isSafeInteger(index) || index < 0 || shared[index] === undefined) throw new Error('INVALID_SHARED_STRING');
            value = shared[index]!;
          } else if (cell.attributes.t === 'inlineStr') value = find(cell.children, 'is').map(visible).join('');
          values.push(`${address}: ${JSON.stringify(value)}${formula ? ` [formula=${JSON.stringify(plain(formula))}; cached value, not recalculated]` : ''}`);
          if (formula && !v) target.issues.push({reason: `FORMULA_WITHOUT_CACHE: sheet ${name}, cell ${address}`});
        }
        target.add('table', `sheet:${name};row:${row.attributes.r ?? count + 1}`, values.join('\n'));
        count++;
      }
      if (!count) target.add('table', `sheet:${name}`, '');
      for (const relation of relationships(part).values()) {
        if (!relation.Type?.endsWith('/drawing')) continue;
        const drawing = resolve(part, relation);
        if (drawing) await images(drawing, read(drawing), `sheet:${name};drawing`);
        else target.add('image', `sheet:${name};drawing`, '', {issue: 'MISSING_DRAWING'});
      }
    }
  }
}
