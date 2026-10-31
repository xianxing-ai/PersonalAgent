import {createRequire} from 'node:module';
import {copyFile, mkdir, readFile, writeFile} from 'node:fs/promises';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';

const require = createRequire(import.meta.url);
const target = fileURLToPath(new URL('../dist/document-import/ocr-data/', import.meta.url));
await mkdir(target, {recursive: true});
const manifest = [];
for (const code of ['eng', 'chi_sim']) {
  const root = dirname(require.resolve(`@tesseract.js-data/${code}/package.json`));
  const name = `${code}.traineddata.gz`;
  const source = join(root, '4.0.0_best_int', name);
  const bytes = await readFile(source);
  await copyFile(source, join(target, name));
  const metadata = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  manifest.push({code, package: metadata.name, version: metadata.version,
    license: metadata.license, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex')});
}
await writeFile(join(target, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`Bundled ${manifest.length} local OCR languages (${manifest.reduce((sum, item) => sum + item.bytes, 0)} bytes).`);
