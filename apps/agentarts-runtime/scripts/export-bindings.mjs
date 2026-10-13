import {createHash} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {getOwnedBindings} from '@personal-agent/agentarts';

const bindings = getOwnedBindings();
if (bindings.length !== 11 || bindings.filter(item => item.type === 'workflow').length !== 8
  || bindings.filter(item => item.type === 'controller').length !== 3
  || new Set(bindings.map(item => item.id)).size !== bindings.length) throw Error('Invalid owned binding catalog');
const record = {schemaVersion:1,bindingVersion:'1.0.0',verification:'unverified',
  catalogSha256:createHash('sha256').update(JSON.stringify(bindings)).digest('hex'),bindings};
const encoded = JSON.stringify(record,null,2)+'\n';
const destination = fileURLToPath(new URL('../../../docs/modules/OWNED-IMAGE-BINDINGS.json',import.meta.url));
if (process.argv.includes('--write')) await writeFile(destination,encoded);
else if (process.argv.includes('--check')) {
  const actual = await readFile(destination,'utf8');
  if (actual.replaceAll('\r\n','\n') !== encoded) throw Error('Owned binding catalog is stale; rebuild and export --write');
}
else process.stdout.write(encoded);
