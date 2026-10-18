import { readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
let html=await readFile(resolve(root,'dist/index.html'),'utf8');
const scripts=[...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"[^>]*><\/script>/g)];
for(const [tag,src] of scripts) {
  if(!src.startsWith('./assets/'))throw Error('Unexpected external build script');
  const text=(await readFile(resolve(root,'dist',src),'utf8')).replace(/<\/script/gi,'<\\/script');
  html=html.replace(tag,()=>'<script type="module">'+text+'</script>');
}
const styles=[...html.matchAll(/<link\b[^>]*rel="stylesheet"[^>]*href="([^"]+)"[^>]*>/g)];
for(const [tag,src] of styles) {
  if(!src.startsWith('./assets/'))throw Error('Unexpected external build stylesheet');
  const css=await readFile(resolve(root,'dist',src),'utf8');
  html=html.replace(tag,()=>'<style>'+css+'</style>');
}
if(/<(script|link)\b[^>]*(src|href)="\.\/assets\//.test(html))throw Error('Unbundled local dependency');
// Keep the committed offline artifact deterministic across Windows and Linux checkouts.
await writeFile(resolve(root,'dist/architecture.html'),html.replace(/\r\n?/g,'\n'));
process.stdout.write('Self-contained offline architecture: dist/architecture.html\n');
