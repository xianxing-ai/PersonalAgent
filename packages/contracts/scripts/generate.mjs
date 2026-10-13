import { readFile, writeFile } from 'node:fs/promises';
import { compile } from 'json-schema-to-typescript';
const schemaPath = new URL('../schema/protocol.json', import.meta.url);
const schema = JSON.parse(await readFile(schemaPath, 'utf8'));
const output = await compile(schema, 'ProtocolContracts', {bannerComment: '// Generated from schema/protocol.json. Do not edit.', unknownAny: true});
const runtime = '// Generated from schema/protocol.json. Do not edit.\nexport default ' + JSON.stringify(schema) + ';\n';
for (const [file, content] of [['generated.ts', output], ['schema.ts', runtime]]) {
  const path = new URL('../src/' + file, import.meta.url);
  if (process.argv.includes('--check')) {
    const current = (await readFile(path, 'utf8')).replaceAll('\r\n', '\n');
    if (current !== content.replaceAll('\r\n', '\n')) throw new Error('Generated files are stale; run contracts generate');
  } else await writeFile(path, content);
}
if (!process.argv.includes('--check')) await writeFile(schemaPath, JSON.stringify(schema, null, 2) + '\n');
const transportPath = new URL('../schema/agentarts-transport.json', import.meta.url);
const transportSchema = JSON.parse(await readFile(transportPath, 'utf8'));
const transportTypes = await compile(transportSchema, 'AgentArtsTransportFrame', {
  bannerComment: '// Generated from schema/agentarts-transport.json. Do not edit.', unknownAny: true,
});
const transportOutput = new URL('../src/agentarts-transport.generated.ts', import.meta.url);
if (process.argv.includes('--check')) {
  const current = (await readFile(transportOutput, 'utf8')).replaceAll('\r\n', '\n');
  if (current !== transportTypes.replaceAll('\r\n', '\n')) throw new Error('Generated transport types are stale; run contracts generate');
} else {
  await writeFile(transportOutput, transportTypes);
  await writeFile(transportPath, JSON.stringify(transportSchema, null, 2) + '\n');
}
