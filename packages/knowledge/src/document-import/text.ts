import {parse} from 'parse5';
import type {DefaultTreeAdapterMap} from 'parse5';
import {KnowledgeError} from '../index.js';
import {DOCUMENT_LIMITS, DocumentUnits, checkDocumentContext} from './common.js';
import type {DocumentReadContext} from './common.js';

export function parseLines(text: string, target: DocumentUnits): void {
  const lines = text.split(/\r?\n/);
  let start = 0;
  let size = 0;
  for (let i = 0; i < lines.length; i++) {
    size += lines[i]!.length + 1;
    if (size >= 12_000 || (lines[i]!.trim() === '' && i > start) || i === lines.length - 1) {
      target.add('text', `lines:${start + 1}-${i + 1}`, lines.slice(start, i + 1).join('\n'));
      start = i + 1; size = 0;
    }
  }
}

export function parseCsv(text: string, target: DocumentUnits): void {
  let row: string[] = [], value = '', quoted = false, closed = false, rowNumber = 1;
  const add = () => {row.push(value); value = ''; closed = false;};
  const flush = () => {
    add();
    target.add('table', `row:${rowNumber++};columns:1-${row.length}`, JSON.stringify(row));
    row = [];
  };
  for (let i = 0; i < text.length; i++) {
    if (i % 4096 === 0) checkDocumentContext(target.context);
    const c = text[i]!;
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {value += '"'; i++;}
      else if (c === '"') {quoted = false; closed = true;}
      else value += c;
    } else if (c === ',' ) add();
    else if (c === '\r' || c === '\n') {if (c === '\r' && text[i + 1] === '\n') i++; flush();}
    else if (c === '"' && value === '' && !closed) quoted = true;
    else if (closed || c === '"') throw new Error('INVALID_CSV');
    else value += c;
  }
  if (quoted) throw new Error('INVALID_CSV');
  if (row.length || value || closed || text.endsWith(',')) flush();
}

type HtmlNode = DefaultTreeAdapterMap['node'];
const blocked = new Set(['script', 'style', 'noscript', 'template', 'head']);
const blocks = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'pre', 'blockquote', 'dt', 'dd', 'figcaption']);
function children(node: HtmlNode): HtmlNode[] {return 'childNodes' in node ? node.childNodes : [];}
function depthLimit(depth: number): void {if (depth > DOCUMENT_LIMITS.xmlDepth) throw new KnowledgeError('LIMIT_EXCEEDED');}
function content(node: HtmlNode, depth = 0): string {
  depthLimit(depth);
  if (node.nodeName === '#text') return (node as DefaultTreeAdapterMap['textNode']).value;
  if ('tagName' in node && blocked.has(node.tagName)) return '';
  if (node.nodeName === 'br') return '\n';
  return children(node).map(child => content(child, depth + 1)).join('');
}

export function parseHtml(text: string, target: DocumentUnits, context: DocumentReadContext): void {
  const document = parse(text, {sourceCodeLocationInfo: true, scriptingEnabled: false});
  const location = (node: HtmlNode): string => {
    const range = 'sourceCodeLocation' in node ? node.sourceCodeLocation : undefined;
    return range ? `lines:${range.startLine}-${range.endLine};element:${node.nodeName}` : `element:${node.nodeName}`;
  };
  function images(node: HtmlNode, depth = 0): void {
    depthLimit(depth);
    if (node.nodeName === 'img' || node.nodeName === 'svg' || node.nodeName === 'canvas') {
      const alt = 'attrs' in node ? node.attrs.find(item => item.name === 'alt')?.value ?? '' : '';
      target.add('image', location(node), alt, {issue: 'HTML_IMAGE_NOT_READ: embedded and external images require separately selected image files'});
      return;
    }
    for (const child of children(node)) images(child, depth + 1);
  }
  function visit(node: HtmlNode, depth = 0): void {
    depthLimit(depth);
    checkDocumentContext(context);
    if ('tagName' in node && blocked.has(node.tagName)) return;
    if (node.nodeName === 'img' || node.nodeName === 'svg' || node.nodeName === 'canvas') {images(node); return;}
    if (node.nodeName === 'table') {
      const rows: string[][] = [];
      function collect(item: HtmlNode, depth = 0): void {
        depthLimit(depth);
        if (item.nodeName === 'tr') rows.push(children(item).filter(c => ['td', 'th'].includes(c.nodeName)).map(child => content(child)));
        else for (const child of children(item)) collect(child, depth + 1);
      }
      collect(node);
      target.add('table', location(node), rows.map(row => JSON.stringify(row)).join('\n'));
      images(node); return;
    }
    if (blocks.has(node.nodeName)) {target.add('text', location(node), content(node)); images(node); return;}
    if (node.nodeName === '#text') {
      const value = content(node);
      if (value.trim()) target.add('text', location(node), value);
      return;
    }
    for (const child of children(node)) visit(child, depth + 1);
  }
  visit(document);
}
