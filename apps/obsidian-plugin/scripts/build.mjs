import {readFileSync, mkdirSync, writeFileSync, copyFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import ts from 'typescript';

const root = fileURLToPath(new URL('../', import.meta.url));
const dist = join(root, 'dist');
mkdirSync(dist, {recursive: true});
// Bundle the existing public adapter and its relative modules; Obsidian remains host-provided.
const entry = fileURLToPath(import.meta.resolve('@personal-agent/knowledge/obsidian'));
const modules = new Map();
function collect(file) {
  const id = './' + file.split(/[\\/]/).at(-1);
  if (modules.has(id)) return id;
  const source = readFileSync(file, 'utf8');
  modules.set(id, '');
  for (const match of source.matchAll(/from ['"](\.\/[^'"]+)['"]/g)) collect(join(dirname(file), match[1]));
  modules.set(id, ts.transpileModule(source, {compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  }}).outputText);
  return id;
}
const adapterId = collect(entry);
const pairingId = collect(fileURLToPath(import.meta.resolve('@personal-agent/knowledge/pairing')));
const bridgeId = collect(fileURLToPath(import.meta.resolve('@personal-agent/knowledge/bridge')));
const adapter = id => `const modules={${[...modules].map(([id, source]) =>
  JSON.stringify(id) + ':function(module,exports,require){\n' + source + '\n}').join(',')}};
const cache={}; const nativeRequire=require;
function load(id){if(!modules[id])return nativeRequire(id);if(cache[id])return cache[id].exports;
const module={exports:{}};cache[id]=module;modules[id](module,module.exports,load);return module.exports;}
module.exports=load(${JSON.stringify(id)});\n`;
writeFileSync(join(dist, 'main.js'), readFileSync(join(root, 'src/main.cjs'), 'utf8')
  .replace("require('@personal-agent/knowledge/obsidian')",
    `(function(){const module={exports:{}};${adapter(adapterId)}return module.exports;})()`)
  .replace("require('@personal-agent/knowledge/pairing')",
    `(function(){const module={exports:{}};${adapter(pairingId)}return module.exports;})()`)
  .replace("require('@personal-agent/knowledge/bridge')",
    `(function(){const module={exports:{}};${adapter(bridgeId)}return module.exports;})()`));
copyFileSync(join(root, 'manifest.json'), join(dist, 'manifest.json'));
console.log('Obsidian package: ' + dist);
