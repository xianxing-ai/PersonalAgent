// This small native-ESM entry has a maintained declaration alongside its source.
// Include both in the package's ordinary dist build, which the image exporter copies.
import {copyFile, mkdir} from 'node:fs/promises';

const source = new URL('../src/observability/', import.meta.url);
const output = new URL('../dist/observability/', import.meta.url);
await mkdir(output, {recursive:true});
for (const filename of ['index.mjs', 'index.d.mts']) {
  await copyFile(new URL(filename, source), new URL(filename, output));
}
