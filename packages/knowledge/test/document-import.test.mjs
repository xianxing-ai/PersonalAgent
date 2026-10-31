import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {deflateSync} from 'node:zlib';
import {zipSync, strToU8} from 'fflate';
import {createCanvas, GlobalFonts} from '@napi-rs/canvas';
import {parseWikiDocument, parseWikiDocumentInWorker, DOCUMENT_LIMITS} from '@personal-agent/knowledge/document-import';

const context = () => ({deadline: new Date(Date.now() + 60_000).toISOString(), signal: new AbortController().signal});
const parse = (name, bytes, extra = {}) => parseWikiDocument({sourceId: 'synthetic-source', name,
  bytes: typeof bytes === 'string' ? new TextEncoder().encode(bytes) : bytes, ...context(), ...extra});
const text = doc => doc.units.map(unit => unit.text).join('\n');
const contentTypes = '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>';
const office = files => zipSync(Object.fromEntries(Object.entries({'[Content_Types].xml': contentTypes, ...files})
  .map(([name, value]) => [name, typeof value === 'string' ? strToU8(value) : value])));
function pdf(objects) {
  const chunks = [Buffer.from('%PDF-1.4\n')], offsets = [0];
  for (let i = 0; i < objects.length; i++) {
    offsets.push(chunks.reduce((sum, b) => sum + b.length, 0));
    chunks.push(Buffer.from(`${i + 1} 0 obj\n`), Buffer.isBuffer(objects[i]) ? objects[i] : Buffer.from(objects[i]), Buffer.from('\nendobj\n'));
  }
  const offset = chunks.reduce((sum, b) => sum + b.length, 0);
  chunks.push(Buffer.from(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map(n => `${String(n).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${offset}\n%%EOF`));
  return new Uint8Array(Buffer.concat(chunks));
}
const stream = (data, fields = '') => {
  const bytes = Buffer.isBuffer(data) ? data : Buffer.from(data);
  return Buffer.concat([Buffer.from(`<< /Length ${bytes.length} ${fields} >>\nstream\n`), bytes, Buffer.from('\nendstream')]);
};

test('text preserves all lines, Unicode and byte revision under safe relative names', async () => {
  const original = '# 项目\n\n预算 2500\n颜色蓝色\n';
  const doc = await parse('project/notes.md', original);
  assert.equal(doc.revision, createHash('sha256').update(original).digest('hex'));
  assert.match(text(doc), /预算 2500[\s\S]*颜色蓝色/);
  assert.ok(doc.units.every(unit => /^lines:\d+-\d+$/.test(unit.locator)));
  assert.equal(doc.coverage.processed, doc.coverage.total);
  assert.deepEqual(doc.coverage.issues, []);
  for (const name of ['../a.md', '/a.md', 'C:\\a.md', 'a//b.md', 'a/./b.md']) {
    await assert.rejects(parse(name, original), {code: 'INVALID_ARGUMENT'});
  }
});

test('CSV preserves commas, quoted newlines, escaped quotes and formulas as data', async () => {
  const doc = await parse('sheet.csv', 'name,value\r\n"甲,乙","第一行\n第二行"\r\n"a""b",=SUM(A1)');
  assert.equal(doc.units.length, 3);
  assert.deepEqual(JSON.parse(doc.units[1].text), ['甲,乙', '第一行\n第二行']);
  assert.deepEqual(JSON.parse(doc.units[2].text), ['a"b', '=SUM(A1)']);
  const invalid = await parse('broken.csv', '"never closed');
  assert.match(invalid.coverage.issues[0].reason, /PARSE_FAILED/);
});

test('HTML excludes executable metadata and preserves table cells while exposing unselected images', async () => {
  const doc = await parse('page.html', '<html><head><script>fetch("https://example.invalid/")</script></head><body><h1>项目 &amp; 计划</h1><p>青岛 <b>出行</b></p><table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table><img src="https://example.invalid/private.png" alt="示意图"></body></html>');
  assert.match(text(doc), /项目 & 计划/);
  assert.doesNotMatch(text(doc), /fetch|example.invalid/);
  assert.equal(doc.units.filter(u => u.kind === 'table').length, 1);
  assert.match(doc.coverage.issues[0].reason, /HTML_IMAGE_NOT_READ/);
  assert.ok(doc.coverage.processed < doc.coverage.total);
});

test('DOCX includes paragraphs, table cells and footnotes without executing fields', async () => {
  const doc = await parse('notes.docx', office({
    'word/document.xml': '<w:document xmlns:w="w"><w:body><w:p><w:r><w:t>预算 2500</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>蓝色</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>',
    'word/footnotes.xml': '<w:footnotes xmlns:w="w"><w:footnote w:id="1"><w:p><w:r><w:t>合成脚注</w:t></w:r></w:p></w:footnote></w:footnotes>',
  }));
  assert.deepEqual(doc.coverage.issues, []);
  assert.match(text(doc), /预算 2500[\s\S]*蓝色[\s\S]*合成脚注/);
  assert.ok(doc.units.some(unit => unit.kind === 'table'));
});

test('PPTX follows presentation relationships and preserves tables and speaker notes', async () => {
  const doc = await parse('slides.pptx', office({
    'ppt/presentation.xml': '<p:presentation xmlns:p="p" xmlns:r="r"><p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst></p:presentation>',
    'ppt/_rels/presentation.xml.rels': '<Relationships><Relationship Id="rId1" Target="slides/slide2.xml"/></Relationships>',
    'ppt/slides/slide2.xml': '<p:sld xmlns:p="p" xmlns:a="a"><a:p><a:r><a:t>幻灯片</a:t></a:r></a:p><a:tbl><a:tr><a:tc><a:p><a:r><a:t>表格</a:t></a:r></a:p></a:tc></a:tr></a:tbl></p:sld>',
    'ppt/slides/_rels/slide2.xml.rels': '<Relationships><Relationship Id="notes" Type="schema/notesSlide" Target="../notesSlides/notesSlide1.xml"/></Relationships>',
    'ppt/notesSlides/notesSlide1.xml': '<p:notes xmlns:p="p" xmlns:a="a"><a:p><a:r><a:t>演讲备注</a:t></a:r></a:p></p:notes>',
  }));
  assert.deepEqual(doc.coverage.issues, []);
  assert.match(text(doc), /幻灯片[\s\S]*表格[\s\S]*演讲备注/);
  assert.ok(doc.units.every(unit => unit.locator.startsWith('slide:1')));
});

test('XLSX keeps shared strings, cell addresses and cached formula results', async () => {
  const doc = await parse('workbook.xlsx', office({
    'xl/workbook.xml': '<workbook xmlns:r="r"><sheets><sheet name="计划" sheetId="1" r:id="rId1"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
    'xl/sharedStrings.xml': '<sst><si><t>青岛</t></si></sst>',
    'xl/worksheets/sheet1.xml': '<worksheet><sheetData><row r="3"><c r="A3" t="s"><v>0</v></c><c r="B3"><f>1+2</f><v>3</v></c></row></sheetData></worksheet>',
  }));
  assert.deepEqual(doc.coverage.issues, []);
  assert.match(doc.units[0].locator, /sheet:计划;row:3/);
  assert.match(text(doc), /A3: "青岛"/);
  assert.match(text(doc), /B3: "3".*formula="1\+2".*not recalculated/);
});

test('ZIP paths, XML entities, malformed format and unsupported input do not become successful documents', async () => {
  for (const bytes of [office({'word/document.xml': '<!DOCTYPE x [<!ENTITY steal SYSTEM "file:///private">]><x>&steal;</x>'}),
    office({'../escape.xml': '<x/>', 'word/document.xml': '<x/>'}),
    office({'word/document.xml': '<wrong-root/>'})]) {
    const doc = await parse('input.docx', bytes);
    assert.ok(doc.coverage.issues.some(issue => /PARSE_FAILED/.test(issue.reason)));
  }
  assert.match((await parse('input.pdf', 'not pdf')).coverage.issues[0].reason, /PARSE_FAILED/);
  assert.match((await parse('input.exe', new Uint8Array([1, 2]))).coverage.issues[0].reason, /UNSUPPORTED_FORMAT/);
});

test('archive expansion metadata and excessive tree depth are bounded before expensive consumption', async () => {
  const bytes = Buffer.from(office({'word/document.xml': '<w:document xmlns:w="w"><w:body/></w:document>'}));
  const central = bytes.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  bytes.writeUInt32LE(DOCUMENT_LIMITS.expandedBytes + 1, central + 24);
  await assert.rejects(parse('bomb.docx', bytes), {code: 'LIMIT_EXCEEDED'});
  await assert.rejects(parse('deep.html', '<div>'.repeat(150) + 'x' + '</div>'.repeat(150)), {code: 'LIMIT_EXCEEDED'});
});

test('cancel, deadline and byte limits reject rather than publishing partial success', async () => {
  const controller = new AbortController(); controller.abort();
  await assert.rejects(parse('a.md', 'x', {signal: controller.signal}), {code: 'CANCELLED'});
  await assert.rejects(parse('a.md', 'x', {deadline: new Date(0).toISOString()}), {code: 'TIMEOUT'});
  await assert.rejects(parse('a.md', new Uint8Array(DOCUMENT_LIMITS.bytes + 1)), {code: 'LIMIT_EXCEEDED'});
});

test('production worker preserves input and terminates on cancellation or deadline', async () => {
  const bytes = new TextEncoder().encode('原始合成材料，预算 2500');
  const before = Uint8Array.from(bytes);
  const request = {sourceId: 'synthetic-source', name: 'folder/a.txt', bytes, ...context()};
  const result = await parseWikiDocumentInWorker(request);
  assert.match(text(result), /预算 2500/);
  assert.deepEqual(bytes, before);
  const controller = new AbortController();
  const pending = parseWikiDocumentInWorker({...request, signal: controller.signal});
  controller.abort();
  await assert.rejects(pending, {code: 'CANCELLED'});
  await assert.rejects(parseWikiDocumentInWorker({...request,
    deadline: new Date(Date.now() + 1).toISOString()}), {code: 'TIMEOUT'});
});

test('PDF extracts page text with physical-page citations', async () => {
  const bytes = pdf([
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 300] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    stream('BT /F1 24 Tf 50 200 Td (Synthetic budget 2500) Tj ET'),
  ]);
  const doc = await parse('report.pdf', bytes);
  assert.deepEqual(doc.coverage.issues, []);
  assert.match(text(doc), /Synthetic budget 2500/);
  assert.equal(doc.units[0].locator, 'page:1;text');
});

test('bundled real local OCR reads a generated image and scanned PDF without network models', {timeout: 90_000}, async () => {
  const canvas = createCanvas(1000, 220);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = 'white'; ctx.fillRect(0, 0, 1000, 220);
  ctx.fillStyle = 'black'; ctx.font = '64px sans-serif';
  ctx.fillText('BUDGET 2500 BLUE', 40, 125);
  const image = new Uint8Array(canvas.toBuffer('image/png'));
  const doc = await parseWikiDocumentInWorker({sourceId: 'synthetic-source', name: 'scan.png', bytes: image, ...context()});
  assert.match(text(doc), /BUDGET\s+2500\s+BLUE/i);
  assert.ok(doc.units[0].confidence >= 0.75);
  const rgba = ctx.getImageData(0, 0, 1000, 220).data;
  const rgb = Buffer.alloc(1000 * 220 * 3);
  for (let i = 0; i < 1000 * 220; i++) {rgb[i * 3] = rgba[i * 4]; rgb[i * 3 + 1] = rgba[i * 4 + 1]; rgb[i * 3 + 2] = rgba[i * 4 + 2];}
  const scanned = pdf([
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 1000 220] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>',
    stream(deflateSync(rgb), '/Type /XObject /Subtype /Image /Width 1000 /Height 220 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode'),
    stream('q 1000 0 0 220 0 0 cm /Im0 Do Q'),
  ]);
  const pdfDoc = await parseWikiDocumentInWorker({sourceId: 'synthetic-source', name: 'scan.pdf', bytes: scanned, ...context()});
  assert.match(text(pdfDoc), /BUDGET\s+2500\s+BLUE/i);
  assert.ok(pdfDoc.units.some(unit => unit.locator === 'page:1;ocr' && unit.confidence >= 0.75));
});

test('bundled Chinese OCR reads synthetic Chinese text when a CJK fixture font exists', {timeout: 60_000}, async t => {
  const font = ['Microsoft YaHei', 'Noto Sans CJK SC'].find(name => GlobalFonts.has(name));
  if (!font) return t.skip('No CJK font installed for rendering the synthetic fixture; English OCR still runs.');
  const canvas = createCanvas(1200, 220), ctx = canvas.getContext('2d');
  ctx.fillStyle = 'white'; ctx.fillRect(0, 0, 1200, 220);
  ctx.fillStyle = 'black'; ctx.font = `64px "${font}"`;
  ctx.fillText('预算2500 颜色蓝色', 40, 130);
  const doc = await parseWikiDocumentInWorker({sourceId: 'synthetic-source', name: 'chinese.png',
    bytes: new Uint8Array(canvas.toBuffer('image/png')), ...context()});
  assert.match(text(doc).replace(/\s/g, ''), /预算2500颜色蓝色/);
});
